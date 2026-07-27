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
import { getMeta } from '../entity/index.js';
import type {
  DialectFeatures,
  FieldOptions,
  QueryComparisonOptions,
  QueryConflictPaths,
  QueryContext,
  QueryOptions,
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
    dropTableCascade: false,
    renameColumn: true,
    foreignKeyAlter: false, // SQLite does not support adding FKs to existing tables
    columnComment: false, // SQLite does not support column comments
    vectorIndexStyle: 'create',
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

  override readonly booleanLiteral = 'integer';

  // SQLite supports `RETURNING` (including on `INSERT ... ON CONFLICT`), so IDs are exact per row.
  override readonly insertIdSource = 'returning';

  protected override readonly vectorDistanceFns: ReadonlyMap<VectorDistance, string> = new Map([
    ['cosine', 'vec_distance_cosine'],
    ['l2', 'vec_distance_L2'],
    ['hamming', 'vec_distance_hamming'],
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

  protected override ilikeExpr(f: string, ph: string): string {
    return `${f} LIKE ${ph}`;
  }

  protected override get neOp(): string {
    return 'IS NOT';
  }

  override normalizeValue(value: unknown): unknown {
    if (value instanceof Date) return value.getTime();
    return super.normalizeValue(value);
  }

  override compare<E>(
    ctx: QueryContext,
    entity: Type<E>,
    key: string,
    val: unknown,
    opts?: QueryComparisonOptions,
  ): void {
    if (key === '$text') {
      const meta = getMeta(entity);
      const search = val as QueryTextSearchOptions<E>;
      const fields = search.$fields!.map((fKey) => {
        const field = meta.fields[fKey];
        const columnName = this.resolveColumnName(fKey, field!);
        return this.escapeId(columnName);
      });
      const tableName = this.resolveTableName(entity, meta);
      ctx.append(`${this.escapeId(tableName)} MATCH {${fields.join(' ')}} : `);
      ctx.addValue(search.$value);
      return;
    }
    super.compare(ctx, entity, key, val, opts);
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

  override insert<E>(ctx: QueryContext, entity: Type<E>, payload: E | E[], opts?: QueryOptions): void {
    super.insert(ctx, entity, payload, opts);
    ctx.append(' ' + this.returningId(entity));
  }

  override upsert<E>(ctx: QueryContext, entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E | E[]): void {
    const meta = getMeta(entity);
    const updateCtx = this.createContext();
    const update = this.getUpsertUpdateAssignments(
      updateCtx,
      meta,
      conflictPaths,
      payload,
      (name) => `EXCLUDED.${name}`,
    );
    const keysStr = this.getUpsertConflictPathsStr(meta, conflictPaths);
    const onConflict = update ? `DO UPDATE SET ${update}` : 'DO NOTHING';
    // Use the base (non-RETURNING) insert here: the appended RETURNING below would otherwise
    // be doubled by `this.insert`'s own.
    super.insert(ctx, entity, payload);
    ctx.append(` ON CONFLICT (${keysStr}) ${onConflict} ${this.returningId(entity)}`);
    ctx.pushValue(...updateCtx.values);
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

  /** `[#]` appends, creating the array when the key is absent. */
  protected override jsonPush(ctx: QueryContext, expr: string, push: Record<string, unknown>): string {
    return jsonAssignCall((value) => this.jsonScalarParam(ctx, value), 'json_insert', expr, push, '[#]');
  }

  protected override jsonUnset(_ctx: QueryContext, expr: string, unset: readonly string[]): string {
    return jsonRemoveCall('json_remove', expr, unset);
  }
}
