import type {
  DialectFeatures,
  FieldOptions,
  InsertIdSource,
  QueryContext,
  QuerySizeComparisonOps,
} from '../type/index.js';
import { escapeMysqlSqlLiteral, escapeSingleQuotes } from '../util/sqlLiteral.js';
import { AbstractSqlDialect } from './abstractSqlDialect.js';
import { JSON_PULL_ALIAS, jsonAssignCall, jsonPath, jsonRemoveCall, jsonSetTarget } from './jsonSql.js';

/**
 * Shared JSON-array / JSON-object operator implementation between MySQL and MariaDB.
 *
 * Both dialects support the MySQL-compatible JSON functions/operators used by:
 * - `$size` (JSON_LENGTH)
 * - `$all` (JSON_CONTAINS)
 * - `$elemMatch` (JSON_TABLE, or fast JSON_CONTAINS for the simple case)
 * - the update operators `$set` (JSON_SET), `$unset` (JSON_REMOVE), `$push` (JSON_MERGE_PRESERVE)
 *   and `$pull` (JSON_REPLACE over JSON_TABLE)
 */
export abstract class MysqlLikeSqlDialect extends AbstractSqlDialect {
  /** Default {@link DialectFeatures} for MySQL-compatible SQL dialects. */
  protected override readonly featureDefaults: DialectFeatures = {
    explicitJsonCast: false,
    nativeArrays: false,
    supportsJsonb: false,
    ifNotExists: true,
    indexIfNotExists: false,
    dropTableCascade: false,
    renameColumn: true,
    foreignKeyAlter: true,
    columnComment: true,
    vectorIndexStyle: 'inline',
    vectorSupportsLength: false,
    supportsTimestamptz: false,
    defaultStringAsText: false,
  };

  override readonly serialPrimaryKey = 'BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY';

  override readonly escapeIdChar = '`';

  override readonly tableOptions = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';

  override readonly beginTransactionCommand = 'START TRANSACTION';

  override readonly commitTransactionCommand = 'COMMIT';

  override readonly rollbackTransactionCommand = 'ROLLBACK';

  override readonly isolationLevelStrategy = 'set-before';

  override readonly dropForeignKeySyntax = 'DROP FOREIGN KEY';

  override readonly dropIndexSyntax = 'on-table';

  override readonly renameTableSyntax = 'rename-table';

  override readonly alterColumnSyntax = 'MODIFY COLUMN';

  override readonly booleanLiteral = 'integer';

  // No `RETURNING` support, so multi-row insert IDs are inferred from the header - see the
  // `innodb_autoinc_lock_mode` caveat on `buildUpdateResult` in `util/sql.util.ts`.
  override readonly insertIdSource: InsertIdSource = 'firstId';

  override readonly maxBindValues: number = 65535;

  override escape(value: unknown): string {
    return escapeMysqlSqlLiteral(value);
  }

  protected override numericCast(expr: string): string {
    return `CAST(${expr} AS DECIMAL)`;
  }

  protected override ilikeExpr(f: string, ph: string): string {
    return `${f} LIKE ${ph}`;
  }

  protected override neExpr(field: string, ph: string): string {
    // MySQL/MariaDB null-safe inequality: true when values differ or one side is NULL.
    return `NOT (${field} <=> ${ph})`;
  }

  /** How a surviving element is fed back into the array a `$pull` rebuilds. */
  protected jsonPullElem(alias: string): string {
    return `${alias}.v`;
  }

  /** Condition keeping the elements a `$pull` does *not* remove, given the bound pulled value. */
  protected jsonPullKeep(alias: string, operand: string): string {
    return `${alias}.v <> ${operand}`;
  }

  /**
   * `JSON_REPLACE` leaves an absent key (and a NULL column) untouched, which is what makes `$pull`
   * a no-op there. The subquery reads the column, so its value binds exactly once.
   */
  protected override jsonPullKey(
    ctx: QueryContext,
    expr: string,
    escapedCol: string,
    key: string,
    value: unknown,
  ): string {
    const elements = `JSON_TABLE(${escapedCol}, ${jsonPath(key, '[*]')} COLUMNS (v JSON PATH '$')) ${JSON_PULL_ALIAS}`;
    const kept = `SELECT COALESCE(JSON_ARRAYAGG(${this.jsonPullElem(JSON_PULL_ALIAS)}), JSON_ARRAY()) FROM ${elements} WHERE ${this.jsonPullKeep(JSON_PULL_ALIAS, this.jsonScalarParam(ctx, value))}`;
    return `JSON_REPLACE(${expr}, ${jsonPath(key)}, (${kept}))`;
  }

  /**
   * Omitting the `COALESCE` on a NOT NULL column keeps MySQL's partial in-place JSON update
   * applicable: it requires the target column as the direct `JSON_SET` input.
   */
  protected override jsonSet(
    ctx: QueryContext,
    expr: string,
    set: Record<string, unknown>,
    field?: FieldOptions,
  ): string {
    return jsonAssignCall(
      (value) => this.jsonScalarParam(ctx, value),
      'JSON_SET',
      jsonSetTarget(expr, field, `'{}'`),
      set,
    );
  }

  /**
   * `JSON_MERGE_PRESERVE` concatenates arrays and creates absent keys, so every pushed key is
   * handled in one call that references `expr` once - unlike `JSON_ARRAY_APPEND`, which needs a
   * second reference for the array source and returns NULL on MariaDB for an absent key.
   */
  protected override jsonPush(ctx: QueryContext, expr: string, push: Record<string, unknown>): string {
    const entries = Object.entries(push).map(
      ([key, value]) => `'${escapeSingleQuotes(key)}', JSON_ARRAY(${this.jsonScalarParam(ctx, value)})`,
    );
    return `JSON_MERGE_PRESERVE(${expr}, JSON_OBJECT(${entries.join(', ')}))`;
  }

  protected override jsonUnset(_ctx: QueryContext, expr: string, unset: readonly string[]): string {
    return jsonRemoveCall('JSON_REMOVE', expr, unset);
  }

  /**
   * MySQL's `->`/`->>` take a full JSON path (`'$.a.b'`, never a bare key) and only apply to a
   * column reference, so the whole dotted path goes into a single accessor instead of the base's
   * chained `col->'a'->>'b'`, which the server rejects with "Invalid JSON path expression".
   */
  protected override getJsonPathScalarExpr(escapedColumn: string, jsonPathStr: string): string {
    return `(${escapedColumn}->>${jsonPath(jsonPathStr)})`;
  }

  protected override getJsonPathJsonbExpr(escapedColumn: string, jsonPathStr: string): string {
    return `${escapedColumn}->${jsonPath(jsonPathStr)}`;
  }

  protected override jsonAll(ctx: QueryContext, jsonField: string, value: unknown): string {
    return `JSON_CONTAINS(${jsonField}, ${this.addValue(ctx.values, JSON.stringify(value))})`;
  }

  protected override jsonSize(ctx: QueryContext, jsonField: string, value: number | QuerySizeComparisonOps): string {
    return this.buildFragment(ctx, (fragmentCtx) =>
      this.buildSizeComparison(fragmentCtx, () => fragmentCtx.append(`JSON_LENGTH(${jsonField})`), value),
    );
  }

  /**
   * `JSON_TABLE` needs its columns declared upfront, so the object form maps `fields` to columns.
   * The scalar form's column is `JSON`, not `TEXT`, when `asJson` - `TEXT PATH '$'` silently reads
   * a compound (array/object) element as `NULL`, since MySQL doesn't coerce those to text; only a
   * true scalar element survives that coercion. A nested `$elemMatch` (each element being an array
   * that itself gets exploded) always requests `asJson`, so this is what makes that case reach the
   * inner elements at all rather than finding nothing.
   */
  protected override jsonElemFrom(jsonField: string, fields: readonly string[], alias: string, asJson = false): string {
    const columns = fields.length
      ? fields.map((field) => `${this.escapeId(field, true)} TEXT PATH ${jsonPath(field)}`).join(', ')
      : `elem_text ${asJson ? 'JSON' : 'TEXT'} PATH '$'`;
    return `JSON_TABLE(${jsonField}, '$[*]' COLUMNS (${columns})) AS ${alias}`;
  }

  protected override jsonElemRef(alias: string, field?: string, asJson = false): string {
    const ref = field === undefined ? `${alias}.elem_text` : `${alias}.${this.escapeId(field, true)}`;
    // `JSON_TABLE` columns stay `TEXT` so the string operators keep working; the JSON form reads
    // that text back as JSON.
    return asJson ? this.jsonCast(ref) : ref;
  }
}
