import { jsonTypeMode } from '../../dialect/jsonSql.js';
import type { IndexType } from '../../schema/types.js';
import type { IndexFeature, IndexJsonArray, IndexJsonPath, IndexSchema } from '../../type/index.js';
import { unsupportedVectorMetric, VECTOR_INDEX_TYPES } from '../../type/vector.js';
import { IndexDdl } from './indexDdl.js';

/**
 * A full-text index is its own keyword here (`CREATE FULLTEXT INDEX ... (cols)`); `USING fulltext` is
 * a syntax error, so it is the keyword that changes rather than the access method.
 */
const MYSQL_LIKE_INDEX_KEYWORDS: ReadonlyMap<IndexType, string> = new Map([['fulltext', 'FULLTEXT INDEX']]);

/** `CREATE INDEX ... (cols) USING btree`, plus the types this family spells as a keyword instead. */
export class MysqlLikeIndexDdl extends IndexDdl {
  protected override readonly indexFeatures = new Set<IndexFeature>(['expression', 'prefixLength']);

  protected override readonly indexTypes: ReadonlySet<IndexType> = new Set<IndexType>(['btree', 'hash', 'fulltext']);

  protected override readonly indexTypeKeywords: ReadonlyMap<IndexType, string> = MYSQL_LIKE_INDEX_KEYWORDS;

  /**
   * InnoDB fills a fulltext index added beside another on a loaded table only once the table is optimized:
   * until then MariaDB scores it 0 and MySQL can fail a `MATCH` over it (MySQL 26.7, MariaDB 12.3).
   */
  override settleStatements(tableName: string, index: IndexSchema): string[] {
    return index.type === 'fulltext' ? [`OPTIMIZE TABLE ${this.dialect.escapeId(tableName)};`] : [];
  }

  /** ` USING btree|hash` trails the columns: between the table and them, it is a syntax error here. */
  protected override indexTuning(index: IndexSchema): string {
    return index.type && !this.indexTypeKeywords.has(index.type) ? ` USING ${index.type}` : '';
  }
}

export class MySqlIndexDdl extends MysqlLikeIndexDdl {
  protected override readonly indexFeatures = new Set<IndexFeature>([
    'expression',
    'prefixLength',
    'jsonPath',
    'jsonArray',
  ]);

  /**
   * A number as the query reads it. A string as `CHAR(n)` in the collation `->>` returns, which the
   * planner strips back to the bare `->>` a query compares; any other collation leaves it unused. A
   * boolean compares as JSON, which no key part can hold.
   */
  protected override jsonPathIndexExpr(escapedColumn: string, json: IndexJsonPath): string {
    const mode = jsonTypeMode(json.type);
    if (mode === 'json') {
      throw new TypeError(`mysql cannot index the boolean JSON path '${json.path}', which compares as JSON`);
    }
    const expr = super.jsonPathIndexExpr(escapedColumn, json);
    if (mode === 'numeric') {
      return expr;
    }
    if (!json.length) {
      throw new TypeError(`a MySQL index over the string JSON path '${json.path}' needs a length`);
    }
    return `CAST(${expr} AS CHAR(${json.length}) CHARACTER SET utf8mb4) COLLATE utf8mb4_bin`;
  }

  /**
   * `CAST(col AS CHAR(64) ARRAY)`, over the column itself where the array is the whole document -
   * which is what `$all` reads, and what its `JSON_CONTAINS(col, ?)` is matched against. A `path`
   * indexes the array at that path instead, as `'tags.ids': { $all: [...] }` reads it.
   */
  protected override jsonArrayIndexExpr(escapedColumn: string, json: IndexJsonArray): string {
    const source = json.path ? this.dialect.jsonPathExpr(escapedColumn, json.path, 'json') : escapedColumn;
    return `CAST(${source} AS ${arrayCastType(json)} ARRAY)`;
  }

  /**
   * MySQL 26.7 has `VECTOR` columns and `STRING_TO_VECTOR`, but no distance function outside
   * HeatWave, hence no vector index to build: `USING hnsw` is a syntax error, `VECTOR INDEX` MariaDB's.
   */
  protected override readonly indexTypeHints = new Map<IndexType, string>(
    VECTOR_INDEX_TYPES.map((type) => [type, '. Vector search on MySQL needs HeatWave']),
  );
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

  protected override readonly indexTypes = new Set<IndexType>(['btree', 'hash', 'fulltext', 'vector']);

  /** pgvector's names are not access methods it has; `vector` is its own keyword above. */
  protected override readonly indexTypeHints = new Map<IndexType, string>([
    ['hnsw', "; declare type: 'vector' instead"],
    ['ivfflat', "; declare type: 'vector' instead"],
  ]);

  /**
   * `M=n DISTANCE=metric`, trailing its `CREATE VECTOR INDEX`. The metric names are MariaDB's own
   * (`euclidean`, not `l2`), and an unsupported one throws rather than being dropped, which would
   * silently build the index on euclidean - its default - instead of what the entity asked for.
   */
  protected override indexTuning(index: IndexSchema): string {
    let tuning = super.indexTuning(index) + (index.m === undefined ? '' : ` M=${index.m}`);
    if (index.distance) {
      const metric = this.dialect.vectorMetrics.get(index.distance)?.index;
      if (!metric) {
        throw unsupportedVectorMetric(this.dialect.dialectName, index.distance, index.name);
      }
      tuning += ` DISTANCE=${metric}`;
    }
    return tuning;
  }
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
