import { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import { buildElemMatchConditions } from '../dialect/jsonArrayElemMatchUtils.js';
import { getMeta } from '../entity/index.js';
import type {
  DialectFeatures,
  FieldKey,
  FieldOptions,
  JsonUpdateOp,
  QueryComparisonOptions,
  QueryConflictPaths,
  QueryContext,
  QueryOptions,
  QuerySizeComparisonOps,
  QueryTextSearchOptions,
  QueryWhereFieldOperatorMap,
  Type,
  VectorDistance,
} from '../type/index.js';
import { escapeAnsiSqlLiteral } from '../util/ansiSqlLiteral.js';
import { hasKeys } from '../util/index.js';

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

  override readonly quoteChar = '`';

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

  override compareFieldOperator<E, K extends keyof QueryWhereFieldOperatorMap<E>>(
    ctx: QueryContext,
    entity: Type<E>,
    key: FieldKey<E>,
    op: K,
    val: QueryWhereFieldOperatorMap<E>[K],
    opts: QueryComparisonOptions = {},
  ): void {
    switch (op) {
      case '$elemMatch':
        this.buildElemMatchCondition(ctx, entity, key, val as Record<string, unknown>, opts);
        break;
      case '$all': {
        // SQLite: Check JSON array contains all values using multiple json_each subqueries
        const values = val as unknown[];
        const conditions = values
          .map((v) => {
            ctx.pushValue(JSON.stringify(v));
            return `EXISTS (SELECT 1 FROM json_each(${this.escapeId(key)}) WHERE value = json(?))`;
          })
          .join(' AND ');
        ctx.append(`(${conditions})`);
        break;
      }
      case '$size':
        // SQLite: Check JSON array length
        // e.g., json_array_length(roles) = 3, or json_array_length(roles) >= 2
        this.buildSizeComparison(
          ctx,
          () => {
            ctx.append('json_array_length(');
            this.getComparisonKey(ctx, entity, key, opts);
            ctx.append(')');
          },
          val as number | QuerySizeComparisonOps,
        );
        break;
      default:
        super.compareFieldOperator(ctx, entity, key, op, val, opts);
    }
  }

  /**
   * Build $elemMatch condition for SQLite JSON arrays.
   * Uses EXISTS with json_each and supports nested operators.
   */
  private buildElemMatchCondition<E>(
    ctx: QueryContext,
    _entity: Type<E>,
    key: FieldKey<E>,
    match: Record<string, unknown>,
    opts: QueryComparisonOptions,
  ): void {
    ctx.append('EXISTS (SELECT 1 FROM json_each(');
    this.getComparisonKey(ctx, _entity, key, opts);
    ctx.append(') WHERE ');

    const conditions = buildElemMatchConditions(
      match,
      (field, op, opVal) =>
        this.buildJsonFieldCondition(ctx, (f) => `json_extract(value, '$.${this.escapeJsonKey(f)}')`, field, op, opVal),
      (field, value) => {
        // Keep SQLite's placeholder behavior consistent with prior implementation.
        ctx.pushValue(value);
        return `json_extract(value, '$.${this.escapeJsonKey(field)}') = ?`;
      },
    );

    ctx.append(conditions.join(' AND '));
    ctx.append(')');
  }

  protected override getJsonPathScalarExpr(escapedColumn: string, jsonPath: string): string {
    return `json_extract(${escapedColumn}, '$.${this.escapeJsonKey(jsonPath)}')`;
  }

  protected override numericCast(expr: string): string {
    return `CAST(${expr} AS REAL)`;
  }

  override insert<E>(ctx: QueryContext, entity: Type<E>, payload: E | E[], opts?: QueryOptions): void {
    super.insert(ctx, entity, payload, opts);
    ctx.append(' ' + this.returningId(entity));
  }

  override upsert<E>(ctx: QueryContext, entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E | E[]): void {
    // Use the base (non-RETURNING) insert here: `onConflictUpsert` appends its own RETURNING
    // after the ON CONFLICT clause, so calling `this.insert` would append it twice.
    this.onConflictUpsert(ctx, entity, conflictPaths, payload, (c, e, p) => super.insert(c, e, p));
  }

  protected override formatJsonUpdate<E>(ctx: QueryContext, escapedCol: string, value: JsonUpdateOp<E>): void {
    let expr = escapedCol;
    if (hasKeys(value.$merge)) {
      const merge = value.$merge as Record<string, unknown>;
      expr = `json_set(COALESCE(${escapedCol}, '{}')`;
      for (const [key, v] of Object.entries(merge)) {
        expr += `, '$.${this.escapeJsonKey(key)}', json(?)`;
        ctx.pushValue(JSON.stringify(v));
      }
      expr += ')';
    }
    if (hasKeys(value.$push)) {
      const push = value.$push as Record<string, unknown>;
      expr = `json_insert(${expr}`;
      for (const [key, v] of Object.entries(push)) {
        expr += `, '$.${this.escapeJsonKey(key)}[#]', json(?)`;
        ctx.pushValue(JSON.stringify(v));
      }
      expr += ')';
    }
    if (value.$unset?.length) {
      const paths = value.$unset.map((k) => `'$.${this.escapeJsonKey(k)}'`).join(', ');
      expr = `json_remove(${expr}, ${paths})`;
    }
    ctx.append(`${escapedCol} = ${expr}`);
  }

  override escape(value: unknown): string {
    return escapeAnsiSqlLiteral(value);
  }
}
