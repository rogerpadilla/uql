import { jsonTypeMode } from '../../dialect/jsonSql.js';
import type { IndexColumnSchema, IndexJsonArray, IndexJsonPath, IndexSchema } from '../../type/index.js';
import { isVectorIndexType } from '../../type/vector.js';
import { UqlUsageError } from '../../util/uqlError.js';
import { IndexDdl } from './indexDdl.js';

/** `CREATE INDEX ... (cols) USING btree`, plus the types this family spells as a keyword instead. */
export class MysqlLikeIndexDdl extends IndexDdl {
  /**
   * InnoDB fills a fulltext index added beside another on a loaded table only once the table is optimized:
   * until then MariaDB scores it 0 and MySQL can fail a `MATCH` over it (MySQL 26.7, MariaDB 12.3).
   */
  override settleStatements(tableName: string, index: IndexSchema): string[] {
    return index.type === 'fulltext' ? [`OPTIMIZE TABLE ${this.dialect.escapeId(tableName)};`] : [];
  }

  /** ` USING btree|hash` trails the columns: between the table and them, it is a syntax error here. */
  protected override indexTuning(index: IndexSchema): string {
    return this.usingType(index);
  }
}

export class MySqlIndexDdl extends MysqlLikeIndexDdl {
  /**
   * A number as the query reads it. A string as `CHAR(n)` in the collation `->>` returns, which the
   * planner strips back to the bare `->>` a query compares; any other collation leaves it unused. A
   * boolean compares as JSON, which no key part can hold.
   */
  protected override jsonPathIndexExpr(escapedColumn: string, json: IndexJsonPath): string {
    const mode = jsonTypeMode(json.type);
    if (mode === 'json') {
      throw new UqlUsageError(`mysql cannot index the boolean JSON path '${json.path}', which compares as JSON`);
    }
    const expr = super.jsonPathIndexExpr(escapedColumn, json);
    if (mode === 'numeric') {
      return expr;
    }
    if (!json.length) {
      throw new UqlUsageError(`a MySQL index over the string JSON path '${json.path}' needs a length`);
    }
    return `CAST(${expr} AS CHAR(${json.length}) CHARACTER SET utf8mb4) COLLATE utf8mb4_bin`;
  }

  /**
   * A JSON array entry is MySQL's multi-valued index, one key per element: `CAST(col AS CHAR(64) ARRAY)`,
   * over the column itself where the array is the whole document, which is what `$all`'s
   * `JSON_CONTAINS(col, ?)` is matched against. A `path` indexes the array at that path instead.
   */
  protected override indexColumnTarget(entry: IndexColumnSchema): string {
    const json = entry.jsonArray;
    if (!json) {
      return super.indexColumnTarget(entry);
    }
    const column = this.dialect.escapeId(entry.column);
    const source = json.path ? this.dialect.jsonPathExpr(column, json.path, 'json') : column;
    return `(CAST(${source} AS ${arrayCastType(json)} ARRAY))`;
  }
}

export class MariaIndexDdl extends MysqlLikeIndexDdl {
  /**
   * `M=n DISTANCE=metric`, trailing its `CREATE VECTOR INDEX`. The metric names are MariaDB's own
   * (`euclidean`, not `l2`), stated even for the default distance, cosine, since MariaDB's own is
   * euclidean; and an unsupported one throws rather than silently building on euclidean.
   */
  protected override indexTuning(index: IndexSchema): string {
    const tuning = super.indexTuning(index) + (index.m === undefined ? '' : ` M=${index.m}`);
    return isVectorIndexType(index.type) ? `${tuning} DISTANCE=${this.indexMetric(index)}` : tuning;
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
    throw new UqlUsageError(`mysql has no array cast for ${typeof type === 'string' ? type : type.name} elements`);
  }
  if (cast !== 'CHAR' && cast !== 'BINARY') {
    return cast;
  }
  if (!json.length) {
    throw new UqlUsageError(
      `a multi-valued index over ${cast === 'CHAR' ? 'string' : 'binary'} elements needs a length`,
    );
  }
  return `${cast}(${json.length})`;
}
