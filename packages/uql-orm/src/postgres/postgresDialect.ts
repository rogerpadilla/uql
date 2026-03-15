import sqlstring from 'sqlstring-sqlite';
import { AbstractSqlDialect } from '../dialect/index.js';
import { getMeta } from '../entity/index.js';
import {
  type Dialect,
  type EntityMeta,
  type FieldKey,
  type FieldOptions,
  type JsonMergeOp,
  type NamingStrategy,
  type QueryComparisonOptions,
  type QueryConflictPaths,
  type QueryContext,
  type QueryOptions,
  QueryRaw,
  type QuerySizeComparisonOps,
  type QueryTextSearchOptions,
  type QueryVectorSearch,
  type QueryWhereFieldOperatorMap,
  type Type,
  type VectorDistance,
} from '../type/index.js';
import { hasKeys, isJsonType } from '../util/index.js';

export class PostgresDialect extends AbstractSqlDialect {
  constructor(namingStrategy?: NamingStrategy, dialect: Dialect = 'postgres') {
    super(dialect, namingStrategy);
  }

  override addValue(values: unknown[], value: unknown): string {
    values.push(value);
    return this.placeholder(values.length);
  }

  override placeholder(index: number): string {
    return `$${index}`;
  }

  override insert<E>(ctx: QueryContext, entity: Type<E>, payload: E | E[], opts?: QueryOptions): void {
    super.insert(ctx, entity, payload, opts);
    ctx.append(' ' + this.returningId(entity));
  }

  override upsert<E>(ctx: QueryContext, entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E | E[]): void {
    const meta = getMeta(entity);
    const update = this.getUpsertUpdateAssignments(ctx, meta, conflictPaths, payload, (name) => `EXCLUDED.${name}`);
    const keysStr = this.getUpsertConflictPathsStr(meta, conflictPaths);
    const onConflict = update ? `DO UPDATE SET ${update}` : 'DO NOTHING';
    super.insert(ctx, entity, payload);
    // xmax system column is 0 for newly inserted rows, non-zero for updated rows (MVCC).
    ctx.append(
      ` ON CONFLICT (${keysStr}) ${onConflict} ${this.returningId(entity)}, (xmax = 0) AS ${this.escapeId('_created')}`,
    );
  }

  override compare<E>(
    ctx: QueryContext,
    entity: Type<E>,
    key: string,
    val: unknown,
    opts: QueryComparisonOptions = {},
  ): void {
    if (key === '$text') {
      const meta = getMeta(entity);
      const search = val as QueryTextSearchOptions<E>;
      const fields = (search.$fields ?? [])
        .map((fKey) => {
          const field = meta.fields[fKey];
          const columnName = this.resolveColumnName(fKey, field!);
          return this.escapeId(columnName);
        })
        .join(` || ' ' || `);
      ctx.append(`to_tsvector(${fields}) @@ to_tsquery(`);
      ctx.addValue(search.$value);
      ctx.append(')');
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
    opts: QueryOptions = {},
  ): void {
    switch (op) {
      case '$istartsWith':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' ILIKE ');
        ctx.addValue(`${val}%`);
        break;
      case '$iendsWith':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' ILIKE ');
        ctx.addValue(`%${val}`);
        break;
      case '$iincludes':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' ILIKE ');
        ctx.addValue(`%${val}%`);
        break;
      case '$ilike':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' ILIKE ');
        ctx.addValue(val);
        break;
      case '$in':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' = ANY(');
        ctx.addValue(val);
        ctx.append(')');
        break;
      case '$nin':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' <> ALL(');
        ctx.addValue(val);
        ctx.append(')');
        break;
      case '$regex':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' ~ ');
        ctx.addValue(val);
        break;
      case '$elemMatch':
        this.buildElemMatchCondition(ctx, entity, key, val as Record<string, unknown>, opts);
        break;
      case '$all':
        // PostgreSQL: JSONB array contains all specified values
        // e.g., tags @> '["typescript", "orm"]'::jsonb
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' @> ');
        ctx.addValue(JSON.stringify(val));
        ctx.append('::jsonb');
        break;
      case '$size':
        // PostgreSQL: Check JSONB array length
        // e.g., jsonb_array_length(roles) = 3, or jsonb_array_length(roles) >= 2
        this.buildSizeComparison(
          ctx,
          () => {
            ctx.append('jsonb_array_length(');
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
   * Build $elemMatch condition for PostgreSQL JSONB arrays.
   * - Simple objects (no operators): Use fast @> containment
   * - Objects with operators ($ilike, $regex, etc.): Use EXISTS subquery
   */
  private buildElemMatchCondition<E>(
    ctx: QueryContext,
    entity: Type<E>,
    key: FieldKey<E>,
    match: Record<string, unknown>,
    opts: QueryOptions,
  ): void {
    // Check if any field value contains operators
    const hasOperators = Object.values(match).some(
      (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).some((k) => k.startsWith('$')),
    );

    if (!hasOperators) {
      // Simple case: use fast @> containment operator
      // e.g., addresses @> '[{"city": "NYC"}]'::jsonb
      this.getComparisonKey(ctx, entity, key, opts);
      ctx.append(' @> ');
      ctx.addValue(JSON.stringify([match]));
      ctx.append('::jsonb');
      return;
    }

    // Complex case: use EXISTS with jsonb_array_elements
    // e.g., EXISTS (SELECT 1 FROM jsonb_array_elements(addresses) AS elem WHERE elem->>'city' ILIKE $1)
    ctx.append('EXISTS (SELECT 1 FROM jsonb_array_elements(');
    this.getComparisonKey(ctx, entity, key, opts);
    ctx.append(') AS elem WHERE ');

    const conditions: string[] = [];
    for (const [field, value] of Object.entries(match)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Value is an operator object
        const ops = value as Record<string, unknown>;
        for (const [op, opVal] of Object.entries(ops)) {
          conditions.push(this.buildJsonFieldOperator(ctx, field, op, opVal));
        }
      } else {
        // Simple equality
        conditions.push(`elem->>'${field}' = ${this.addValue(ctx.values, value)}`);
      }
    }

    ctx.append(conditions.join(' AND '));
    ctx.append(')');
  }

  /**
   * Build a comparison condition for a JSON field with an operator.
   * Returns the SQL condition string.
   */
  private buildJsonFieldOperator(ctx: QueryContext, field: string, op: string, value: unknown): string {
    return this.buildJsonFieldCondition(
      ctx,
      { ...this.getBaseJsonConfig(), fieldAccessor: (f) => `elem->>'${f}'` },
      field,
      op,
      value,
    );
  }

  protected override getBaseJsonConfig() {
    return {
      numericCast: (expr: string) => `(${expr})::numeric`,
      likeFn: 'LIKE',
      ilikeExpr: (f: string, ph: string) => `${f} ILIKE ${ph}`,
      regexpOp: '~',
      addValue: (c: QueryContext, v: unknown) => this.addValue(c.values, v),
      inExpr: (f: string, ph: string) => `${f} = ANY(${ph})`,
      ninExpr: (f: string, ph: string) => `${f} <> ALL(${ph})`,
      neExpr: (f: string, ph: string) => `${f} IS DISTINCT FROM ${ph}`,
    };
  }

  protected override formatPersistableValue<E>(ctx: QueryContext, field: FieldOptions, value: unknown): void {
    if (value instanceof QueryRaw) {
      super.formatPersistableValue(ctx, field, value);
      return;
    }
    if (isJsonType(field.type)) {
      ctx.addValue(value ? JSON.stringify(value) : null);
      ctx.append(`::${field.type}`);
      return;
    }
    if (field.type === 'vector' && Array.isArray(value)) {
      ctx.addValue(`[${value.join(',')}]`);
      ctx.append('::vector');
      return;
    }
    super.formatPersistableValue(ctx, field, value);
  }

  /** pgvector distance operators. */
  private static readonly VECTOR_OPS: Record<VectorDistance, string> = {
    cosine: '<=>',
    l2: '<->',
    inner: '<#>',
    l1: '<+>',
    hamming: '<~>',
  };

  /** Emit a pgvector distance expression: `"col" <op> $N::<vectorType>`. */
  protected override appendVectorSort<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    key: string,
    search: QueryVectorSearch,
  ): void {
    const { colName, distance, vectorCast } = this.resolveVectorSortParams(meta, key, search);
    const op = PostgresDialect.VECTOR_OPS[distance];
    ctx.append(`${this.escapeId(colName)} ${op} `);
    ctx.addValue(`[${search.$vector.join(',')}]`);
    ctx.append(`::${vectorCast}`);
  }

  protected override formatJsonMerge<E>(ctx: QueryContext, escapedCol: string, value: JsonMergeOp<E>): void {
    let expr = escapedCol;
    if (hasKeys(value.$merge)) {
      ctx.pushValue(JSON.stringify(value.$merge));
      expr = `COALESCE(${escapedCol}, '{}') || ${this.placeholder(ctx.values.length)}::jsonb`;
    }
    if (value.$unset?.length) {
      for (const key of value.$unset) {
        expr = `(${expr}) - '${this.escapeJsonKey(key)}'`;
      }
    }
    ctx.append(`${escapedCol} = ${expr}`);
  }

  override escape(value: unknown): string {
    return sqlstring.escape(value);
  }
}
