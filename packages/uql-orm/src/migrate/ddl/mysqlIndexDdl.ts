import { jsonPath } from '../../dialect/jsonSql.js';
import { MARIA_VECTOR_METRICS } from '../../maria/mariaVectorMetrics.js';
import type { IndexType } from '../../schema/types.js';
import type { IndexFeature, IndexJsonArray, IndexSchema } from '../../type/index.js';
import { isVectorIndexType } from '../../type/vector.js';
import { IndexDdl } from './indexDdl.js';

/**
 * A full-text index is its own keyword here (`CREATE FULLTEXT INDEX ... (cols)`); `USING fulltext` is
 * a syntax error, so it is the keyword that changes rather than the access method.
 */
const MYSQL_LIKE_INDEX_KEYWORDS: ReadonlyMap<IndexType, string> = new Map([['fulltext', 'FULLTEXT INDEX']]);

/** `CREATE INDEX ... USING btree`, plus the types this family spells as a keyword instead. */
export class MysqlLikeIndexDdl extends IndexDdl {
  protected override readonly indexFeatures = new Set<IndexFeature>(['expression', 'prefixLength']);

  protected override readonly indexTypeKeywords: ReadonlyMap<IndexType, string> = MYSQL_LIKE_INDEX_KEYWORDS;

  /**
   * ` USING btree|hash`, for the types this family does *not* spell as a keyword of its own. A vector
   * type that is neither is one this engine has no index for at all, refused here rather than
   * compiled into a ` USING hnsw` the server can only answer with a syntax error: which of them a
   * dialect *does* have is `indexTypeKeywords`, so declaring one there is all it takes to serve it.
   */
  protected override indexAccessMethod(index: IndexSchema): string {
    const type = index.type;
    if (!type || this.indexTypeKeywords.has(type)) {
      return '';
    }
    if (isVectorIndexType(type)) {
      throw new TypeError(
        `${this.dialect.dialectName} has no ${type} index (index "${index.name}")${this.vectorIndexHint}`,
      );
    }
    return ` USING ${type}`;
  }

  /** What to do instead, appended to the refusal above. */
  protected readonly vectorIndexHint: string = '';
}

export class MySqlIndexDdl extends MysqlLikeIndexDdl {
  /** The multi-valued index is the only JSON index MySQL has - see `IndexFeature` for why. */
  protected override readonly indexFeatures = new Set<IndexFeature>(['expression', 'prefixLength', 'jsonArray']);

  /**
   * `CAST(col AS CHAR(64) ARRAY)`, over the column itself where the array is the whole document -
   * which is what `$all` reads, and what its `JSON_CONTAINS(col, ?)` is matched against. A `path`
   * indexes the array at that path instead, as `'tags.ids': { $all: [...] }` reads it.
   */
  protected override jsonArrayIndexExpr(escapedColumn: string, json: IndexJsonArray): string {
    const source = json.path ? `${escapedColumn}->${jsonPath(json.path)}` : escapedColumn;
    return `CAST(${source} AS ${arrayCastType(json)} ARRAY)`;
  }

  /**
   * MySQL has no vector index of any kind, so one is refused rather than compiled to DDL the server
   * rejects: `USING hnsw` is a syntax error, and MariaDB's `VECTOR INDEX` is not MySQL syntax either.
   * Verified against 26.7, which does have `VECTOR` columns and `STRING_TO_VECTOR`, but no distance
   * function outside HeatWave - hence nothing to index for.
   */
  protected override readonly vectorIndexHint = '. Vector search on MySQL needs HeatWave';
}

export class MariaIndexDdl extends MysqlLikeIndexDdl {
  /**
   * MariaDB has no functional indexes: `CREATE INDEX ... ((lower(col)))` is a syntax error even on
   * 12.3, where the documented workaround is a generated column. So it keeps the prefix lengths the
   * family shares and drops expressions - and with them both JSON index forms, which are expressions.
   */
  protected override readonly indexFeatures = new Set<IndexFeature>(['prefixLength']);

  /** The family's, plus a vector index of its own: `CREATE VECTOR INDEX ... ON t (col)`, 11.7+. */
  protected override readonly indexTypeKeywords: ReadonlyMap<IndexType, string> = new Map([
    ...MYSQL_LIKE_INDEX_KEYWORDS,
    ['vector', 'VECTOR INDEX'],
  ]);

  /**
   * `M=n DISTANCE=metric`, trailing its `CREATE VECTOR INDEX`. The metric names are MariaDB's own
   * (`euclidean`, not `l2`), and an unsupported one throws rather than being dropped, which would
   * silently build the index on euclidean - its default - instead of what the entity asked for.
   */
  protected override indexTuning(index: IndexSchema): string {
    let tuning = index.m === undefined ? '' : ` M=${index.m}`;
    if (index.distance) {
      const metric = MARIA_VECTOR_METRICS.get(index.distance);
      if (!metric) {
        throw new TypeError(
          `${this.dialect.dialectName} does not support vector distance metric: ${index.distance} (index "${index.name}")`,
        );
      }
      tuning += ` DISTANCE=${metric}`;
    }
    return tuning;
  }

  /** `vector` is its own keyword above; pgvector's names are not access methods it has. */
  protected override readonly vectorIndexHint = "; declare type: 'vector' instead";
}

/**
 * MySQL's `CAST(... AS <type> ARRAY)` targets, the closed list its multi-valued index takes: no
 * `FLOAT`, no `BOOLEAN`, no `JSON`. A `DECIMAL` element is the way to index a fractional one.
 */
const ARRAY_CASTS = new Map<unknown, string>([
  [String, 'CHAR'],
  [Number, 'SIGNED'],
  [BigInt, 'SIGNED'],
  [Date, 'DATETIME'],
  ['char', 'CHAR'],
  ['varchar', 'CHAR'],
  ['text', 'CHAR'],
  ['uuid', 'CHAR'],
  ['int', 'SIGNED'],
  ['integer', 'SIGNED'],
  ['tinyint', 'SIGNED'],
  ['smallint', 'SIGNED'],
  ['bigint', 'SIGNED'],
  ['decimal', 'DECIMAL'],
  ['numeric', 'DECIMAL'],
  ['date', 'DATE'],
  ['time', 'TIME'],
  ['datetime', 'DATETIME'],
  ['timestamp', 'DATETIME'],
  ['blob', 'BINARY'],
  ['bytea', 'BINARY'],
]);

/** The cast an element type compiles to; the sized ones need their length, since it sizes the key. */
function arrayCastType(json: IndexJsonArray): string {
  const type = json.type;
  const cast = ARRAY_CASTS.get(typeof type === 'string' ? type.toLowerCase() : type);
  if (!cast) {
    throw new TypeError(`mysql has no array cast for ${typeof type === 'string' ? type : type.name} elements`);
  }
  if (cast !== 'CHAR' && cast !== 'BINARY') {
    return cast;
  }
  if (!json.length) {
    throw new TypeError(`a multi-valued index over ${cast === 'CHAR' ? 'string' : 'binary'} elements needs a length`);
  }
  return `${cast}(${json.length})`;
}
