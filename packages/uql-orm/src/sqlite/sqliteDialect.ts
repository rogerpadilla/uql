import { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import {
  JSON_ELEM_ALIAS_PREFIX,
  JSON_PULL_ALIAS,
  jsonAssignCall,
  jsonElemExists,
  jsonPath,
  jsonRemoveCall,
  jsonSetTarget,
} from '../dialect/jsonSql.js';
import type {
  DialectFeatures,
  EntityMeta,
  FieldOptions,
  QueryContext,
  QuerySizeComparisonOps,
  QueryTextSearchOptions,
  Type,
  VectorDistance,
} from '../type/index.js';

export class SqliteDialect extends AbstractSqlDialect {
  /** Default {@link DialectFeatures} for SQLite and SQLite-derived dialects. */
  protected override readonly featureDefaults: DialectFeatures = {
    explicitJsonCast: false,
    nativeArrays: false,
    supportsJsonb: false,
    ifNotExists: true,
    indexIfNotExists: true,
    schemas: false, // SQLite's namespaces are attached database files, not declared objects
    dropTableCascade: false,
    renameColumn: true,
    foreignKeyAlter: false, // SQLite does not support adding FKs to existing tables
    columnComment: false, // SQLite does not support column comments
    inlineVectorIndex: false,
    vectorSupportsLength: false,
    supportsTimestamptz: false,
    defaultStringAsText: true,
  };

  override readonly dialectName = 'sqlite';

  override readonly escapeIdChar = '`';

  override readonly serialPrimaryKey = 'INTEGER PRIMARY KEY AUTOINCREMENT';

  override readonly tableOptions = '';

  override readonly beginTransactionCommand = 'BEGIN TRANSACTION';

  override readonly commitTransactionCommand = 'COMMIT';

  override readonly rollbackTransactionCommand = 'ROLLBACK';

  override readonly isolationLevelStrategy = 'none';

  override readonly alterColumnSyntax = 'none';

  /** SQLite locks the whole database, not rows, so `$lock` has nothing to map onto. */
  override readonly supportsRowLocks = false;

  override readonly booleanLiteral = 'integer';

  // SQLite supports `RETURNING` (including on `INSERT ... ON CONFLICT`), so IDs are exact per row.
  override readonly insertIdSource = 'returning';

  /**
   * The [sqlite-vec](https://github.com/asg017/sqlite-vec) functions, which need that extension
   * loaded on the connection (see `Sqlite3QuerierPool`'s `extensions` option). libSQL and Turso ship
   * their own vector functions instead, so `LibsqlDialect` overrides this.
   */
  protected override readonly vectorDistanceFns: ReadonlyMap<VectorDistance, string> = new Map([
    ['cosine', 'vec_distance_cosine'],
    ['l2', 'vec_distance_L2'],
    ['l1', 'vec_distance_L1'],
  ]);

  /**
   * SQLite does not support the `DEFAULT` keyword inside `VALUES`. Inline the metadata default
   * when declared, else `NULL` (which is also how SQLite auto-generates INTEGER PRIMARY KEYs).
   */
  protected override appendDefaultInsertValue(ctx: QueryContext, field: FieldOptions | undefined): void {
    if (field?.defaultValue !== undefined) {
      this.formatPersistableValue(ctx, field, field.defaultValue);
    } else {
      ctx.append('NULL');
    }
  }

  // SQLite's `LIKE` already ignores case on both sides, for ASCII - and only ASCII, with or without
  // `NOCASE`, so folding the pattern here would break the accented text the engine leaves alone.
  protected override readonly caseInsensitiveMatch = 'native';

  protected override get neOp(): string {
    return 'IS NOT';
  }

  override normalizeValue(value: unknown): unknown {
    if (value instanceof Date) return value.getTime();
    return super.normalizeValue(value);
  }

  /**
   * FTS5 matches the table itself rather than its columns, so this only works when the table *is* an
   * FTS5 virtual table (UQL does not create those; declare it outside your entities).
   */
  protected override appendTextSearch<E>(
    ctx: QueryContext,
    entity: Type<E>,
    meta: EntityMeta<E>,
    search: QueryTextSearchOptions<E>,
  ): void {
    const columns = search.$fields!.map((key) => this.escapeId(this.resolveColumnName(key, meta.fields[key])));
    ctx.append(`${this.escapedTableName(meta)} MATCH {${columns.join(' ')}} : `);
    ctx.addValue(search.$value);
  }

  /**
   * SQLite compares an exploded element as whole JSON text, so containment cannot express "this
   * element includes these keys" - `$elemMatch` always expands to per-field conditions.
   */
  protected override readonly jsonContainmentIsPartial = false;

  /** `json_each` exposes a JSON boolean as `0`/`1` and a number as a number - already comparable. */
  protected override readonly jsonScalarElemKeepsType = true;

  /**
   * Each element is read back as JSON text through `->` at its own `fullkey`, so it compares
   * correctly whatever its type. `json_each`'s `value` column would not: it unquotes strings (`a`
   * vs `"a"`), flattens booleans to 0/1, and stringifies objects.
   */
  protected override jsonAll(ctx: QueryContext, jsonField: string, value: unknown): string {
    const alias = ctx.nextAlias(JSON_ELEM_ALIAS_PREFIX);
    const from = this.jsonElemFrom(jsonField, [], alias);
    const conditions = (value as unknown[]).map((val) =>
      jsonElemExists(from, [`${jsonField} -> ${alias}.fullkey = ${this.jsonScalarParam(ctx, val)}`]),
    );
    return `(${conditions.join(' AND ')})`;
  }

  protected override jsonSize(ctx: QueryContext, jsonField: string, value: number | QuerySizeComparisonOps): string {
    return this.buildFragment(ctx, (fragmentCtx) =>
      this.buildSizeComparison(fragmentCtx, () => fragmentCtx.append(`json_array_length(${jsonField})`), value),
    );
  }

  /** `json_each` yields both scalar and object elements, so one form covers each case. */
  protected override jsonElemFrom(jsonField: string, _fields: readonly string[], alias: string): string {
    return `json_each(${jsonField}) ${alias}`;
  }

  protected override jsonElemRef(alias: string, field?: string, asJson = false): string {
    if (field === undefined) {
      return `${alias}.value`;
    }
    return asJson ? `${alias}.value -> ${jsonPath(field)}` : `json_extract(${alias}.value, ${jsonPath(field)})`;
  }

  protected override getJsonPathScalarExpr(escapedColumn: string, jsonPathStr: string): string {
    return `json_extract(${escapedColumn}, ${jsonPath(jsonPathStr)})`;
  }

  protected override numericCast(expr: string): string {
    return `CAST(${expr} AS REAL)`;
  }

  protected override jsonCast(operand: string): string {
    return `json(${operand})`;
  }

  /**
   * `json_replace` leaves an absent key (and a NULL column) untouched. Elements are read back
   * through `->` at their own `fullkey` so each keeps its JSON type - `json_each`'s `value` would
   * flatten booleans to 0/1 and stringify objects.
   */
  protected override jsonPullKey(
    ctx: QueryContext,
    expr: string,
    escapedCol: string,
    key: string,
    value: unknown,
  ): string {
    const path = jsonPath(key);
    const elem = `${escapedCol} -> ${JSON_PULL_ALIAS}.fullkey`;
    const kept = `SELECT json_group_array(json(${elem})) FROM json_each(${escapedCol}, ${path}) ${JSON_PULL_ALIAS} WHERE ${elem} <> ${this.jsonScalarParam(ctx, value)}`;
    return `json_replace(${expr}, ${path}, (${kept}))`;
  }

  protected override jsonSet(
    ctx: QueryContext,
    expr: string,
    set: Record<string, unknown>,
    field?: FieldOptions,
  ): string {
    return jsonAssignCall(
      (value) => this.jsonScalarParam(ctx, value),
      'json_set',
      jsonSetTarget(expr, field, `'{}'`),
      set,
    );
  }

  /**
   * `[#]` appends, creating the array when the key is absent.
   *
   * @remarks `json_set` rather than `json_insert`: the two are equivalent here because `[#]` always
   * resolves past the end of the array, and Turso's engine implements `json_insert` as create-only,
   * so it silently drops the element when the array already exists.
   */
  protected override jsonPush(ctx: QueryContext, expr: string, push: Record<string, unknown>): string {
    return jsonAssignCall((value) => this.jsonScalarParam(ctx, value), 'json_set', expr, push, '[#]');
  }

  protected override jsonUnset(_ctx: QueryContext, expr: string, unset: readonly string[]): string {
    return jsonRemoveCall('json_remove', expr, unset);
  }
}
