import { getMeta } from '../entity/index.js';
import {
  type EntityMeta,
  type FieldKey,
  type FieldOptions,
  type IdKey,
  type IsolationLevel,
  type JsonColumnType,
  type JsonUpdateOp,
  type Key,
  type Query,
  type QueryAggMap,
  type QueryAggregate,
  type QueryAggregateOp,
  type QueryCompareOp,
  type QueryComparisonOptions,
  type QueryConflictPaths,
  type QueryContext,
  type QueryDialect,
  type QueryExclude,
  type QueryGroupMap,
  type QueryHavingMap,
  type QueryHavingOp,
  type QueryLikeOp,
  type QueryNegateOp,
  type QueryOptions,
  type QueryPager,
  type QueryPopulate,
  QueryRaw,
  type QueryRawFnOptions,
  type QuerySearch,
  type QuerySelect,
  type QuerySelectOptions,
  type QuerySelectValue,
  type QuerySizeComparisonOps,
  type QuerySortDirection,
  type QuerySortMap,
  type QueryTextSearchOptions,
  type QueryVectorSearch,
  type QueryWhere,
  type QueryWhereArray,
  type QueryWhereFieldOperatorMap,
  type QueryWhereMap,
  type QueryWhereOptions,
  RAW_ALIAS,
  RAW_VALUE,
  type RelationOptions,
  type SqlDialectName,
  type SqlQueryDialect,
  type Type,
  type UpdatePayload,
} from '../type/index.js';
import {
  asSelectMap,
  buildQueryWhereAsMap,
  buildSortMap,
  escapeSqlId,
  fillOnFields,
  filterFieldKeys,
  flatObject,
  getFieldKeys,
  getInsertFieldKeys,
  getKeys,
  getRelationRequestSummary,
  getSoftDeleteValue,
  hasKeys,
  hasMultipleKeys,
  isJsonType,
  isJsonUpdateOp,
  isOperatorObject,
  isOperatorOnlyObject,
  isPopulatingRelations,
  isVectorSearch,
  normalizeScalarFieldSelection,
  parseGroupMap,
  parseRelationAtKey,
  parseRelationSize,
  type RelationQuery,
  raw,
  someValue,
  withoutSoftDeleteFilter,
} from '../util/index.js';
import { escapeAnsiSqlLiteral, escapeSingleQuotes } from '../util/sqlLiteral.js';

import { buildElemMatchConditions } from './jsonArrayElemMatchUtils.js';
import { JSON_ELEM_ALIAS_PREFIX, jsonElemExists } from './jsonSql.js';
import { SqlQueryContext } from './queryContext.js';
import { VectorSqlDialect } from './vectorSqlDialect.js';

/** {@link JsonUpdateOp} as the dialects consume it: plain keys and values, no entity typing. */
type JsonUpdateOperators = {
  readonly $set?: Record<string, unknown>;
  readonly $unset?: readonly string[];
  readonly $push?: Record<string, unknown>;
  readonly $pull?: Record<string, unknown>;
};

export abstract class AbstractSqlDialect extends VectorSqlDialect implements QueryDialect, SqlQueryDialect {
  // Narrow dialect type from Dialect to SqlDialect
  abstract override readonly dialectName: SqlDialectName;

  abstract readonly escapeIdChar: '"' | '`';
  abstract readonly serialPrimaryKey: string;
  abstract readonly tableOptions: string;
  abstract readonly beginTransactionCommand: string;
  abstract readonly commitTransactionCommand: string;
  abstract readonly rollbackTransactionCommand: string;

  readonly isolationLevelStrategy: 'inline' | 'set-before' | 'none' = 'inline';

  readonly alterColumnStrategy: 'separate-clauses' | 'single-statement' = 'single-statement';

  readonly alterColumnSyntax: 'ALTER COLUMN' | 'MODIFY COLUMN' | 'none' = 'ALTER COLUMN';

  readonly dropForeignKeySyntax: 'DROP CONSTRAINT' | 'DROP FOREIGN KEY' = 'DROP CONSTRAINT';

  readonly dropIndexSyntax: 'on-table' | 'standalone' = 'standalone';

  readonly renameTableSyntax: 'rename-table' | 'alter-table' = 'alter-table';

  readonly booleanLiteral: 'native' | 'integer' = 'native';

  /**
   * Maximum number of bind parameters the driver accepts in a single statement.
   * `insertMany` splits larger batches into multiple statements based on this limit.
   */
  readonly maxBindValues: number = 32766;

  getBeginTransactionStatements(isolationLevel?: IsolationLevel): string[] {
    const level = isolationLevel?.toUpperCase();
    const strategy = this.isolationLevelStrategy;
    if (!level || strategy === 'none') {
      return [this.beginTransactionCommand];
    }
    if (strategy === 'inline') {
      return [`${this.beginTransactionCommand} ISOLATION LEVEL ${level}`];
    }
    // 'set-before' - MySQL/MariaDB pattern
    return [`SET TRANSACTION ISOLATION LEVEL ${level}`, this.beginTransactionCommand];
  }

  createContext(): QueryContext {
    return new SqlQueryContext(this);
  }

  /**
   * Builds SQL text in isolation via `build`, so the caller can embed it inline (e.g.
   * `"col" = <text>`) instead of appending it at the end of `ctx`. The fragment binds any value
   * straight into `ctx`'s own values array - shared by reference, not copied - so `addValue` numbers
   * its placeholder correctly against the real query from the start; a fresh, empty array would
   * instead number from `1` regardless of how many values `ctx` already has, misnumbering every
   * bound value on `$n`-placeholder dialects once `ctx` isn't otherwise empty.
   */
  protected buildFragment(ctx: QueryContext, build: (fragmentCtx: QueryContext) => void): string {
    const fragmentCtx = new SqlQueryContext(this, ctx.values);
    build(fragmentCtx);
    return fragmentCtx.sql;
  }

  addValue(values: unknown[], value: unknown): string {
    values.push(this.normalizeValue(value));
    return this.placeholder(values.length);
  }

  /**
   * Normalizes a parameter value for the database driver.
   * Handles bigint, boolean, and serializes plain objects/arrays to JSON strings.
   * Date values are preserved so SQL drivers can apply native date/time binding.
   * Postgres overrides to pass objects through to its native JSONB driver.
   */
  normalizeValue(value: unknown): unknown {
    if (value == null || value instanceof Date || value instanceof Uint8Array || value instanceof QueryRaw) {
      return value;
    }
    if (typeof value === 'bigint') {
      return Number(value);
    }
    if (typeof value === 'boolean') {
      return this.booleanLiteral === 'native' ? value : value ? 1 : 0;
    }
    return value;
  }

  /**
   * Normalizes a list of parameter values.
   */
  normalizeValues(values: unknown[] | undefined): unknown[] | undefined {
    return values?.map((v) => this.normalizeValue(v));
  }

  placeholder(_index: number): string {
    return '?';
  }

  returningId<E>(entity: Type<E>): string {
    const meta = getMeta(entity);
    const idKey = (meta.id ?? 'id') as IdKey<E>;
    const idName = this.columnOf(meta, idKey);
    return `RETURNING ${this.escapeId(idName)} ${this.escapeId('id')}`;
  }

  search<E>(ctx: QueryContext, entity: Type<E>, q: Query<E> = {}, opts: QueryOptions = {}): void {
    const meta = getMeta(entity);
    const tableName = this.resolveTableName(entity, meta);
    const prefix = this.resolveRelationAwarePrefix(tableName, meta, opts, asSelectMap(q.$select), q.$populate);
    if (opts.prefix !== prefix) {
      opts = { ...opts, prefix };
    }
    this.where<E>(ctx, entity, q.$where, opts);
    this.sort<E>(ctx, entity, q.$sort, opts);
    this.pager(ctx, q);
  }

  selectFields<E>(
    ctx: QueryContext,
    entity: Type<E>,
    select: QuerySelectValue<E> | undefined,
    opts: QuerySelectOptions = {},
    exclude?: QueryExclude<E>,
  ): void {
    const meta = getMeta(entity);
    const prefix = opts.prefix ? opts.prefix + '.' : '';
    const escapedPrefix = this.escapeId(opts.prefix as string, true, true);

    let selectArr: (FieldKey<E> | QueryRaw)[];

    if (select) {
      if (Array.isArray(select)) {
        // Raw SQL projections passed as QueryRaw[]
        selectArr = select;
      } else {
        selectArr = normalizeScalarFieldSelection(meta, asSelectMap(select), exclude);
      }

      const id = meta.id;
      if (id && opts.prefix && !selectArr.includes(id)) {
        selectArr = [id, ...selectArr];
      }
    } else {
      selectArr = normalizeScalarFieldSelection(meta, undefined, exclude);
    }

    if (!selectArr.length) {
      ctx.append(escapedPrefix + '*');
      return;
    }

    selectArr.forEach((key, index) => {
      if (index > 0) ctx.append(', ');
      if (key instanceof QueryRaw) {
        this.getRawValue(ctx, {
          value: key,
          prefix: opts.prefix,
          escapedPrefix,
          autoPrefixAlias: opts.autoPrefixAlias,
        });
      } else {
        const field = meta.fields[key];
        if (!field) return;
        const columnName = this.resolveColumnName(key, field);
        if (field.virtual) {
          this.getRawValue(ctx, {
            value: raw(field.virtual[RAW_VALUE], key),
            prefix: opts.prefix,
            escapedPrefix,
            autoPrefixAlias: opts.autoPrefixAlias,
          });
        } else {
          ctx.append(escapedPrefix + this.escapeId(columnName));
        }
        if (!field.virtual && (columnName !== key || opts.autoPrefixAlias)) {
          const aliasStr = prefix + key;
          ctx.append(' ' + this.escapeId(aliasStr, true));
        }
      }
    });
  }

  select<E>(
    ctx: QueryContext,
    entity: Type<E>,
    select: QuerySelectValue<E> | undefined,
    exclude?: QueryExclude<E>,
    populate?: QueryPopulate<E>,
    opts: QueryOptions = {},
    distinct?: boolean,
    sort?: QuerySortMap<E>,
  ): void {
    const meta = getMeta(entity);
    const tableName = this.resolveTableName(entity, meta);
    const mapSelect = asSelectMap(select);
    const prefix = this.resolveRelationAwarePrefix(tableName, meta, opts, mapSelect, populate);

    ctx.append(distinct ? 'SELECT DISTINCT ' : 'SELECT ');
    this.selectFields(ctx, entity, select, { prefix }, exclude);
    // Add related fields BEFORE FROM clause
    this.selectRelationFields(ctx, entity, mapSelect, populate, { prefix });
    // Inject vector distance projections when $project is set
    if (sort) {
      const sortMap = buildSortMap(sort);
      for (const [key, val] of Object.entries(sortMap)) {
        if (isVectorSearch(val) && val.$project) {
          ctx.append(', ');
          this.appendVectorProjection(ctx, meta, key, val);
        }
      }
    }
    ctx.append(` FROM ${this.escapeId(tableName)}`);
    // Add JOINs AFTER FROM clause
    this.selectRelationJoins(ctx, entity, mapSelect, populate, { prefix });
  }

  private resolveRelationAwarePrefix<E>(
    tableName: string,
    meta: EntityMeta<E>,
    opts: QueryOptions,
    select?: QuerySelect<E>,
    populate?: QueryPopulate<E>,
  ): string | undefined {
    return (opts.prefix ?? (opts.autoPrefix || isPopulatingRelations(meta, populate))) ? tableName : undefined;
  }

  protected selectRelationFields<E>(
    ctx: QueryContext,
    entity: Type<E>,
    select: QuerySelect<E> | undefined,
    populate: QueryPopulate<E> | undefined,
    opts: { prefix?: string } = {},
  ): void {
    this.forEachJoinableRelation(entity, select, populate, opts, (relEntity, relQuery, joinRelAlias) => {
      ctx.append(', ');
      this.selectFields(
        ctx,
        relEntity,
        relQuery.$select,
        { prefix: joinRelAlias, autoPrefixAlias: true },
        relQuery.$exclude,
      );
      this.selectRelationFields(ctx, relEntity, relQuery.$select, relQuery.$populate, { prefix: joinRelAlias });
    });
  }

  protected selectRelationJoins<E>(
    ctx: QueryContext,
    entity: Type<E>,
    select: QuerySelect<E> | undefined,
    populate: QueryPopulate<E> | undefined,
    opts: { prefix?: string } = {},
  ): void {
    this.forEachJoinableRelation(
      entity,
      select,
      populate,
      opts,
      (relEntity, relQuery, joinRelAlias, relOpts, meta, tableName, required) => {
        const relMeta = getMeta(relEntity);
        const relTableName = this.resolveTableName(relEntity, relMeta);
        const relEntityName = this.escapeId(relTableName);
        const relPath = opts.prefix ? this.escapeId(opts.prefix, true) : this.escapeId(tableName);
        const joinType = required ? 'INNER' : 'LEFT';
        const joinAlias = this.escapeId(joinRelAlias, true);

        ctx.append(` ${joinType} JOIN ${relEntityName} ${joinAlias} ON `);
        let refAppended = false;
        for (const it of relOpts.references ?? []) {
          if (refAppended) ctx.append(' AND ');
          const relField = relMeta.fields[it.foreign];
          const field = meta.fields[it.local];
          const foreignColumnName = this.resolveColumnName(it.foreign, relField);
          const localColumnName = this.resolveColumnName(it.local, field);
          ctx.append(`${joinAlias}.${this.escapeId(foreignColumnName)} = ${relPath}.${this.escapeId(localColumnName)}`);
          refAppended = true;
        }

        // Unconditional, not gated by `relQuery.$where`: a joined relation's own filters (in
        // particular `security: true` ones) must apply even to a bare `$populate: { rel: true }`
        // with no explicit `$where`. `where()` -> `renderWhere()` no-ops cleanly (appends nothing)
        // when there is truly nothing to add, so this is a pure superset of the old behavior.
        this.where(ctx, relEntity, relQuery.$where ?? {}, { prefix: joinRelAlias, clause: 'AND' });

        this.selectRelationJoins(ctx, relEntity, relQuery.$select, relQuery.$populate, { prefix: joinRelAlias });
      },
    );
  }

  /**
   * Iterates over joinable (11/m1) relations for a given select, resolving shared metadata.
   * Used by both `selectRelationFields` and `selectRelationJoins` to avoid duplicated iteration logic.
   */
  private forEachJoinableRelation<E>(
    entity: Type<E>,
    select: QuerySelect<E> | undefined,
    populate: QueryPopulate<E> | undefined,
    opts: { prefix?: string },
    callback: (
      relEntity: Type<object>,
      relQuery: RelationQuery,
      joinRelAlias: string,
      relOpts: RelationOptions,
      meta: EntityMeta<E>,
      tableName: string,
      required: boolean,
    ) => void,
  ): void {
    if (!select && !populate) return;
    const meta = getMeta(entity);
    const tableName = this.resolveTableName(entity, meta);
    const relKeys = getRelationRequestSummary(meta, populate).joinableKeys;
    const prefix = opts.prefix;

    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];
      if (!relOpts?.entity) continue;

      const isFirstLevel = prefix === tableName;
      const joinRelAlias = isFirstLevel ? relKey : prefix ? `${prefix}.${relKey}` : relKey;
      const relEntity = relOpts.entity();
      const { query: relQuery, required } = parseRelationAtKey<E>(relKey, populate);

      callback(relEntity, relQuery, joinRelAlias, relOpts, meta, tableName, required);
    }
  }

  where<E>(ctx: QueryContext, entity: Type<E>, where: QueryWhere<E> = {}, opts: QueryWhereOptions = {}): void {
    const meta = getMeta(entity);
    // Filters are applied once, here at the scope entry point; recursion uses `renderWhere`.
    this.renderWhere(ctx, entity, this.scopedWhereMap(meta, where, opts), opts);
  }

  /** Renders a `$where` tree without applying entity filters (used for same-scope `$and`/`$or` recursion). */
  protected renderWhere<E>(
    ctx: QueryContext,
    entity: Type<E>,
    where: QueryWhere<E> = {},
    opts: QueryWhereOptions = {},
  ): void {
    const meta = getMeta(entity);
    const { usePrecedence, clause = 'WHERE' } = opts;

    where = buildQueryWhereAsMap(meta, where);

    const whereKeys = getKeys(where);

    if (!whereKeys.length) {
      return;
    }

    if (clause) {
      ctx.append(` ${clause} `);
    }

    if (usePrecedence) {
      ctx.append('(');
    }

    const multipleKeys = whereKeys.length > 1;
    // `usePrecedence` is the only field that changes for the children and it is constant across
    // them, so resolve the child options once instead of spreading `opts` per key.
    const childOpts = opts.usePrecedence === multipleKeys ? opts : { ...opts, usePrecedence: multipleKeys };
    let appended = false;
    whereKeys.forEach((key) => {
      const val = (where as Record<string, unknown>)[key];
      if (val === undefined) return;
      if (appended) {
        ctx.append(' AND ');
      }
      this.compare(ctx, entity, key, val, childOpts);
      appended = true;
    });

    if (usePrecedence) {
      ctx.append(')');
    }
  }

  compare<E>(ctx: QueryContext, entity: Type<E>, key: string, val: unknown, opts: QueryComparisonOptions = {}): void {
    const meta = getMeta(entity);

    if (val instanceof QueryRaw) {
      if (key === '$exists' || key === '$nexists') {
        ctx.append(key === '$exists' ? 'EXISTS (' : 'NOT EXISTS (');
        const tableName = this.resolveTableName(entity, meta);
        this.getRawValue(ctx, {
          value: val,
          prefix: tableName,
          escapedPrefix: this.escapeId(tableName, false, true),
        });
        ctx.append(')');
        return;
      }
      this.getComparisonKey(ctx, entity, key as FieldKey<E>, opts);
      ctx.append(' = ');
      this.getRawValue(ctx, { value: val });
      return;
    }

    if (key === '$text') {
      const search = val as QueryTextSearchOptions<E>;
      const searchFields = search.$fields ?? (getFieldKeys(meta.fields) as FieldKey<E>[]);
      const fields = searchFields.map((fKey) => {
        const field = meta.fields[fKey];
        const columnName = this.resolveColumnName(fKey, field);
        return this.escapeId(columnName);
      });
      ctx.append(`MATCH(${fields.join(', ')}) AGAINST(`);
      ctx.addValue(search.$value);
      ctx.append(')');
      return;
    }

    if (key === '$and' || key === '$or' || key === '$not' || key === '$nor') {
      this.compareLogicalOperator(
        ctx,
        entity,
        key as '$and' | '$or' | '$not' | '$nor',
        val as QueryWhereArray<E>,
        opts,
      );
      return;
    }

    // Detect JSONB dot-notation: 'column.path' where column is a registered JSON/JSONB field
    const jsonDot = this.resolveJsonDotPath(meta, key, opts.prefix);
    if (jsonDot) {
      this.compareJsonPath(ctx, jsonDot, val);
      return;
    }

    if (key.includes('.')) {
      throw new TypeError(`path ${key} does not exist in ${meta.name}`);
    }

    const rel = meta.relations[key];
    if (rel) {
      const sizeVal = parseRelationSize(val);
      if (sizeVal !== undefined) {
        this.compareRelationSize(ctx, entity, key, sizeVal, rel, opts);
        return;
      }
      this.compareRelation(ctx, entity, key, val as QueryWhereMap<unknown>, rel, opts);
      return;
    }

    const value = this.normalizeWhereValue(val);
    const operators = getKeys(value) as (keyof QueryWhereFieldOperatorMap<E>)[];

    if (operators.length > 1) {
      ctx.append('(');
    }

    operators.forEach((op, index) => {
      if (index > 0) {
        ctx.append(' AND ');
      }
      this.compareFieldOperator(
        ctx,
        entity,
        key as FieldKey<E>,
        op,
        (value as QueryWhereFieldOperatorMap<E>)[op],
        opts,
      );
    });

    if (operators.length > 1) {
      ctx.append(')');
    }
  }

  protected compareLogicalOperator<E>(
    ctx: QueryContext,
    entity: Type<E>,
    key: '$and' | '$or' | '$not' | '$nor',
    val: QueryWhereArray<E>,
    opts: QueryComparisonOptions,
  ): void {
    const op = AbstractSqlDialect.NEGATE_OP_MAP.get(key as QueryNegateOp) ?? (key as '$and' | '$or');
    const negate = AbstractSqlDialect.NEGATE_OP_MAP.has(key as QueryNegateOp) ? 'NOT' : '';

    const valArr = val ?? [];
    const hasManyItems = valArr.length > 1;

    if ((opts.usePrecedence || negate) && hasManyItems) {
      ctx.append((negate ? negate + ' ' : '') + '(');
    } else if (negate) {
      ctx.append(negate + ' ');
    }

    valArr.forEach((whereEntry, index) => {
      if (index > 0) {
        ctx.append(op === '$or' ? ' OR ' : ' AND ');
      }
      if (whereEntry instanceof QueryRaw) {
        this.getRawValue(ctx, {
          value: whereEntry,
        });
      } else if (whereEntry) {
        this.renderWhere(ctx, entity, whereEntry, {
          prefix: opts.prefix,
          usePrecedence: hasManyItems && !Array.isArray(whereEntry) && hasMultipleKeys(whereEntry as object),
          clause: false,
        });
      }
    });

    if ((opts.usePrecedence || negate) && hasManyItems) {
      ctx.append(')');
    }
  }

  /** Simple comparison operators: `getComparisonKey → op → addValue`. */
  /** Memoizes {@link escapedColumnName}; see there for why it is per dialect instance. */
  private readonly escapedColumns = new WeakMap<FieldOptions, string>();

  private static readonly NEGATE_OP_MAP = new Map<QueryNegateOp, '$and' | '$or'>([
    ['$not', '$and'],
    ['$nor', '$or'],
  ]);

  private static readonly COMPARE_OP_MAP = new Map<QueryCompareOp, string>([
    ['$gt', ' > '],
    ['$gte', ' >= '],
    ['$lt', ' < '],
    ['$lte', ' <= '],
  ]);

  private static readonly LIKE_OP_MAP = new Map<QueryLikeOp, (v: string) => string>([
    ['$startsWith', (v) => `${v}%`],
    ['$istartsWith', (v) => `${v.toLowerCase()}%`],
    ['$endsWith', (v) => `%${v}`],
    ['$iendsWith', (v) => `%${v.toLowerCase()}`],
    ['$includes', (v) => `%${v}%`],
    ['$iincludes', (v) => `%${v.toLowerCase()}%`],
    ['$like', (v) => v],
    ['$ilike', (v) => v.toLowerCase()],
  ]);

  /**
   * The case-insensitive `LIKE_OP_MAP` keys - the value is lowercased, so the comparison must use
   * `ilikeExpr` (Postgres's `ILIKE`) rather than `LIKE`. `$includes` is deliberately excluded even
   * though it starts with the substring `$i`: it is case-sensitive, unlike `$iincludes`.
   */
  private static readonly LIKE_CASE_INSENSITIVE_OPS = new Set<string>([
    '$istartsWith',
    '$iendsWith',
    '$iincludes',
    '$ilike',
  ] satisfies QueryLikeOp[]);

  /** Builds `prefix.column` from an already-resolved field. */
  private columnWithPrefix(key: string, field: FieldOptions | undefined, prefix: string | undefined): string {
    const columnName = this.resolveColumnName(key, field);
    const escapedPrefix = this.escapeId(prefix as string, true, true);
    return escapedPrefix + this.escapeId(columnName);
  }

  /**
   * Resolves the SQL operand for a field comparison.
   * For QueryRaw virtuals, appends the raw expression to ctx and returns undefined.
   */
  protected resolveOperandField<E>(
    ctx: QueryContext,
    entity: Type<E>,
    key: string,
    opts: QueryOptions,
  ): string | undefined {
    const col = getMeta(entity).fields[key];
    if (col?.virtual) {
      this.getComparisonKey(ctx, entity, key as FieldKey<E>, opts);
      return undefined;
    }
    return this.columnWithPrefix(key, col, opts.prefix);
  }

  private appendFieldSql(ctx: QueryContext, field: string | undefined, sql: string): void {
    ctx.append(field ? `${field}${sql}` : sql);
  }

  compareFieldOperator<E, K extends keyof QueryWhereFieldOperatorMap<E>>(
    ctx: QueryContext,
    entity: Type<E>,
    key: FieldKey<E>,
    op: K,
    val: QueryWhereFieldOperatorMap<E>[K],
    opts: QueryOptions = {},
  ): void {
    const field = this.resolveOperandField(ctx, entity, key as string, opts);

    const simpleOp = AbstractSqlDialect.COMPARE_OP_MAP.get(op as QueryCompareOp);
    if (simpleOp) {
      this.appendFieldSql(ctx, field, `${simpleOp}${this.addValue(ctx.values, val)}`);
      return;
    }

    const likeWrap = AbstractSqlDialect.LIKE_OP_MAP.get(op as QueryLikeOp);
    if (likeWrap) {
      this.appendLikeOp(ctx, field, op as string, likeWrap(val as string));
      return;
    }

    switch (op) {
      case '$eq':
      case '$ne':
        this.appendEqNe(ctx, field, op as string, val);
        break;
      case '$regex':
        this.appendFieldSql(ctx, field, ` ${this.regexpOp} ${this.addValue(ctx.values, val)}`);
        break;
      case '$not':
        ctx.append('NOT (');
        this.compare(ctx, entity, key as keyof QueryWhereMap<E>, val as QueryWhereMap<E>[keyof QueryWhereMap<E>], opts);
        ctx.append(')');
        break;
      case '$in':
      case '$nin':
        this.appendInNin(ctx, field, op as string, val);
        break;
      case '$between': {
        const [min, max] = val as [unknown, unknown];
        this.appendFieldSql(
          ctx,
          field,
          ` BETWEEN ${this.addValue(ctx.values, min)} AND ${this.addValue(ctx.values, max)}`,
        );
        break;
      }
      case '$isNull':
        this.appendFieldSql(ctx, field, val ? ' IS NULL' : ' IS NOT NULL');
        break;
      case '$isNotNull':
        this.appendFieldSql(ctx, field, val ? ' IS NOT NULL' : ' IS NULL');
        break;
      case '$all':
        ctx.append(this.jsonAll(ctx, field ?? '', val));
        break;
      case '$size':
        ctx.append(this.jsonSize(ctx, field ?? '', val as number | QuerySizeComparisonOps));
        break;
      case '$elemMatch':
        ctx.append(this.jsonElemMatch(ctx, field ?? '', val as Record<string, unknown>));
        break;
      default:
        throw TypeError(`unknown operator: ${op}`);
    }
  }

  private appendLikeOp(ctx: QueryContext, field: string | undefined, op: string, wrappedVal: string): void {
    const isIlike = AbstractSqlDialect.LIKE_CASE_INSENSITIVE_OPS.has(op);
    const ph = this.addValue(ctx.values, wrappedVal);
    if (isIlike && field) {
      ctx.append(this.ilikeExpr(field, ph));
    } else {
      this.appendFieldSql(ctx, field, ` ${this.likeFn} ${ph}`);
    }
  }

  private appendEqNe(ctx: QueryContext, field: string | undefined, op: string, val: unknown): void {
    if (val === null) {
      this.appendFieldSql(ctx, field, op === '$eq' ? ' IS NULL' : ' IS NOT NULL');
      return;
    }
    const ph = this.addValue(ctx.values, val);
    if (op === '$eq') {
      this.appendFieldSql(ctx, field, ` = ${ph}`);
      return;
    }
    if (field) {
      ctx.append(this.neExpr(field, ph));
    } else {
      this.appendFieldSql(ctx, field, ` ${this.neOp} ${ph}`);
    }
  }

  private appendInNin(ctx: QueryContext, field: string | undefined, op: string, val: unknown): void {
    this.appendFieldSql(ctx, field, this.formatIn(ctx, Array.isArray(val) ? val : [], op === '$nin'));
  }

  /**
   * Build a comparison condition for a JSON field.
   * Used by both `$elemMatch` and dot-notation paths.
   * All dialect-specific behavior comes from overridable methods on `this`.
   */
  protected buildJsonFieldCondition(
    ctx: QueryContext,
    fieldAccessor: (f: string) => string,
    jsonPath: string,
    op: string,
    value: unknown,
    asJson = false,
  ): string {
    const jsonField = fieldAccessor(jsonPath);
    switch (op) {
      case '$eq':
        if (value === null) return `${jsonField} IS NULL`;
        return `${this.jsonComparand(jsonField, value)} = ${this.jsonOperand(ctx, value, asJson)}`;
      case '$ne':
        if (value === null) return `${jsonField} IS NOT NULL`;
        return this.neExpr(this.jsonComparand(jsonField, value), this.jsonOperand(ctx, value, asJson));
      case '$gt':
        return `${this.numericCast(jsonField)} > ${this.addValue(ctx.values, value)}`;
      case '$gte':
        return `${this.numericCast(jsonField)} >= ${this.addValue(ctx.values, value)}`;
      case '$lt':
        return `${this.numericCast(jsonField)} < ${this.addValue(ctx.values, value)}`;
      case '$lte':
        return `${this.numericCast(jsonField)} <= ${this.addValue(ctx.values, value)}`;
      case '$like':
        return `${jsonField} ${this.likeFn} ${this.addValue(ctx.values, value)}`;
      case '$ilike':
        return this.ilikeExpr(jsonField, this.addValue(ctx.values, (value as string).toLowerCase()));
      case '$startsWith':
        return `${jsonField} ${this.likeFn} ${this.addValue(ctx.values, `${value}%`)}`;
      case '$istartsWith':
        return this.ilikeExpr(jsonField, this.addValue(ctx.values, `${(value as string).toLowerCase()}%`));
      case '$endsWith':
        return `${jsonField} ${this.likeFn} ${this.addValue(ctx.values, `%${value}`)}`;
      case '$iendsWith':
        return this.ilikeExpr(jsonField, this.addValue(ctx.values, `%${(value as string).toLowerCase()}`));
      case '$includes':
        return `${jsonField} ${this.likeFn} ${this.addValue(ctx.values, `%${value}%`)}`;
      case '$iincludes':
        return this.ilikeExpr(jsonField, this.addValue(ctx.values, `%${(value as string).toLowerCase()}%`));
      case '$regex':
        return `${jsonField} ${this.regexpOp} ${this.addValue(ctx.values, value)}`;
      case '$in':
      case '$nin':
        return this.jsonInNin(ctx, jsonField, op, value, asJson);
      case '$all':
        return this.jsonAll(ctx, jsonField, value);
      case '$size':
        return this.jsonSize(ctx, jsonField, value as number | QuerySizeComparisonOps);
      case '$elemMatch':
        return this.jsonElemMatch(ctx, jsonField, value as Record<string, unknown>);
      default:
        throw TypeError(`unknown operator: ${op}`);
    }
  }

  private jsonInNin(ctx: QueryContext, jsonField: string, op: string, value: unknown, asJson: boolean): string {
    const values = Array.isArray(value) ? value : [];
    const negate = op === '$nin';
    if (!asJson) {
      return `${this.jsonComparand(jsonField, values)}${this.formatIn(ctx, values, negate)}`;
    }
    // JSON values have no portable array literal, so the set expands into explicit comparisons.
    const comparisons = values.map((val) => `${jsonField} ${negate ? '<>' : '='} ${this.jsonScalarParam(ctx, val)}`);
    return `(${comparisons.join(negate ? ' AND ' : ' OR ')})`;
  }

  /** The bound operand of a JSON comparison: JSON-encoded when comparing against the JSON value. */
  protected jsonOperand(ctx: QueryContext, value: unknown, asJson: boolean): string {
    return asJson ? this.jsonScalarParam(ctx, value) : this.addValue(ctx.values, value);
  }

  /**
   * The left side of a comparison against a JSON scalar, cast when the operand is numeric - see
   * {@link jsonCompareMode} for why each mode exists.
   */
  protected jsonComparand(jsonField: string, value: unknown): string {
    return this.jsonCompareMode(value) === 'numeric' ? this.numericCast(jsonField) : jsonField;
  }

  /**
   * How a JSON scalar has to be compared against `value` (or, for `$in`/`$nin`, against every element
   * of it). Extracting a JSON value yields *text*, which loses the type, so each operand type is
   * compared in the representation every engine agrees on:
   * - `numeric` - cast the accessor. Keeps `1` equal to a stored `1.0`, which strict JSON equality
   *   would not, and satisfies drivers that send typed parameters (`text = integer` otherwise).
   * - `json` - compare the JSON value against a JSON-encoded parameter. No cast recovers a boolean
   *   portably: PostgreSQL raises `text = boolean` and MySQL matches `'true'` against `1`.
   * - `text` - compare as extracted, which is also what the string operators need.
   *
   * Mixed operand types fall back to `text`, since one comparison cannot be two shapes at once.
   */
  protected jsonCompareMode(value: unknown): 'json' | 'numeric' | 'text' {
    const operands = Array.isArray(value) ? value : [value];
    if (operands.length === 0) {
      return 'text';
    }
    if (operands.every((operand) => typeof operand === 'boolean')) {
      return 'json';
    }
    return operands.every((operand) => typeof operand === 'number') ? 'numeric' : 'text';
  }

  /** `$all`: the JSON array at `jsonField` contains every value (also serves element containment). */
  protected abstract jsonAll(ctx: QueryContext, jsonField: string, value: unknown): string;

  /** `$size`: the length of the JSON array at `jsonField`, compared against `value`. */
  protected abstract jsonSize(ctx: QueryContext, jsonField: string, value: number | QuerySizeComparisonOps): string;

  /**
   * Explodes the JSON array at `jsonField` into rows, as the `FROM` of an `EXISTS` subquery, under
   * `alias` (from {@link QueryContext.nextAlias} - a fresh name per call, since `$elemMatch`/`$all`
   * can recurse into this on a nested array and a fixed, reused alias would let the inner occurrence
   * shadow the outer one it needs to correlate against). An empty `fields` means the elements are
   * scalars, in which case `asJson` says whether they are read as JSON or as text; otherwise they
   * are objects and `fields` are the keys the conditions will read (MySQL needs them upfront for its
   * `JSON_TABLE` column list).
   */
  protected abstract jsonElemFrom(
    jsonField: string,
    fields: readonly string[],
    alias: string,
    asJson?: boolean,
  ): string;

  /**
   * References an exploded element under `alias` (the same one passed to the {@link jsonElemFrom}
   * call it explodes): the element itself, or one `field` of it. `asJson` asks for the JSON-valued
   * form instead of the text one - see {@link isJsonbOp} for when that matters.
   */
  protected abstract jsonElemRef(alias: string, field?: string, asJson?: boolean): string;

  /**
   * Whether the dialect's array containment ({@link jsonAll}) matches an object element that merely
   * *includes* the given keys, as PostgreSQL's `@>` and MySQL's `JSON_CONTAINS` do. SQLite compares
   * elements as whole JSON text, so it cannot express a partial match and always expands the
   * per-field form below.
   */
  protected readonly jsonContainmentIsPartial: boolean = true;

  /**
   * Whether an exploded *scalar* element keeps its SQL type. SQLite's `json_each` yields JSON
   * booleans as `0`/`1` integers and numbers as numbers, so such an element compares directly to a
   * bound value; PostgreSQL and MySQL explode scalars to text, losing the type, so a non-string
   * operand there has to compare as JSON (see {@link isJsonbOp}).
   */
  protected readonly jsonScalarElemKeepsType: boolean = false;

  /**
   * `$elemMatch`: at least one element of the JSON array satisfies `match`. Three shapes, decided
   * here so every dialect only supplies {@link jsonElemFrom} / {@link jsonElemRef}:
   * - keys are operators (`{ $startsWith: 'ad' }`) - scalar elements, conditions on the element;
   * - a plain object with no nested operators - containment, which is the only form an index serves;
   * - otherwise - per-field conditions over the exploded objects.
   */
  protected jsonElemMatch(ctx: QueryContext, jsonField: string, match: Record<string, unknown>): string {
    // Conditions on the element itself. One `FROM` serves them all, so the element is read as JSON
    // only when *every* operand needs it - the same all-operands rule the comparison classifier uses.
    if (isOperatorOnlyObject(match)) {
      const entries = Object.entries(match);
      const asJson = !this.jsonScalarElemKeepsType && entries.every(([op, val]) => this.isJsonbOp(op, val));
      const alias = ctx.nextAlias(JSON_ELEM_ALIAS_PREFIX);
      const conditions = entries.map(([op, val]) =>
        this.buildJsonFieldCondition(ctx, () => this.jsonElemRef(alias, undefined, asJson), '', op, val, asJson),
      );
      return jsonElemExists(this.jsonElemFrom(jsonField, [], alias, asJson), conditions);
    }
    if (isOperatorObject(match)) {
      throw TypeError(`$elemMatch cannot mix operators with field names: ${Object.keys(match).join(', ')}`);
    }

    // A plain object with no nested operators is containment, which is also the only form an index
    // can serve. SQLite compares elements exactly, so it always expands the per-field form below.
    if (this.jsonContainmentIsPartial && !someValue(match, isOperatorObject)) {
      return this.jsonAll(ctx, jsonField, [match]);
    }

    const alias = ctx.nextAlias(JSON_ELEM_ALIAS_PREFIX);
    const conditions = buildElemMatchConditions(match, (field, op, opVal) => {
      const asJson = this.isJsonbOp(op, opVal);
      return this.buildJsonFieldCondition(ctx, (f) => this.jsonElemRef(alias, f, asJson), field, op, opVal, asJson);
    });
    return jsonElemExists(this.jsonElemFrom(jsonField, Object.keys(match), alias), conditions);
  }

  /**
   * Whether the operator reads the JSON *value* instead of its text form. The array operators always
   * do. Equality joins them for boolean operands, because extracting JSON as text loses the type in
   * a way no cast recovers portably: PostgreSQL raises `operator does not exist: text = boolean`,
   * MySQL compares `'true'` to `1` and silently matches nothing, and SQLite's `json_extract` yields
   * `1`. Comparing the JSON value against a JSON-encoded parameter is exact on every dialect.
   *
   * Numbers stay on the text accessor with a numeric cast ({@link jsonComparand}), which keeps
   * `1` equal to `1.0` - JSON equality would not.
   */
  protected isJsonbOp(op: string, value?: unknown): boolean {
    if (op === '$all' || op === '$size' || op === '$elemMatch') {
      return true;
    }
    const comparesValue = op === '$eq' || op === '$ne' || op === '$in' || op === '$nin';
    return comparesValue && this.jsonCompareMode(value) === 'json';
  }

  /**
   * A JSON-encoded bound parameter, cast to the dialect's JSON type. Only the positional-placeholder
   * dialects use this - PostgreSQL binds JSON through {@link PgLikeSqlDialect.jsonScalarParam} instead.
   */
  protected jsonScalarParam(ctx: QueryContext, value: unknown): string {
    if (value instanceof QueryRaw) {
      return this.addValue(ctx.values, value);
    }
    ctx.pushValue(JSON.stringify(value));
    return this.jsonCast('?');
  }

  getComparisonKey<E>(ctx: QueryContext, entity: Type<E>, key: FieldKey<E>, { prefix }: QueryOptions = {}): void {
    const meta = getMeta(entity);
    const escapedPrefix = this.escapeId(prefix as string, true, true);
    const field = meta.fields[key];

    if (field?.virtual) {
      this.getRawValue(ctx, {
        value: field.virtual,
        prefix,
        escapedPrefix,
      });
      return;
    }

    const columnName = this.resolveColumnName(key, field);
    ctx.append(escapedPrefix + this.escapeId(columnName));
  }

  sort<E>(ctx: QueryContext, entity: Type<E>, sort: QuerySortMap<E> | undefined, { prefix }: QueryOptions): void {
    if (!hasKeys(sort)) {
      return;
    }
    const sortMap = buildSortMap(sort);
    const meta = getMeta(entity);

    // Separate vector search entries from direction entries before flattening,
    // because flatObject recursively destructures objects - it would break QueryVectorSearch.
    const vectorEntries: [string, QueryVectorSearch][] = [];
    const directionEntries: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(sortMap)) {
      if (isVectorSearch(val)) {
        vectorEntries.push([key, val]);
      } else {
        directionEntries[key] = val;
      }
    }

    const flattenedSort = flatObject(directionEntries, prefix);

    // Merge: vector entries first (primary ordering), then flattened direction entries.
    const allEntries: [string, unknown][] = [...vectorEntries, ...Object.entries(flattenedSort)];

    if (!allEntries.length) return;

    ctx.append(' ORDER BY ');

    allEntries.forEach(([key, sort], index) => {
      if (index > 0) {
        ctx.append(', ');
      }

      if (isVectorSearch(sort)) {
        if (sort.$project) {
          // Distance already projected in SELECT - reference the alias to avoid recomputation
          ctx.append(this.escapeId(sort.$project));
        } else {
          this.appendVectorSort(ctx, meta, key, sort);
        }
        return;
      }

      const direction = this.resolveSortDirection(sort);

      // Detect JSONB dot-notation: 'column.path'
      const jsonDot = this.resolveJsonDotPath(meta, key);
      if (jsonDot) {
        ctx.append(jsonDot.accessor() + direction);
        return;
      }

      const field = meta.fields[key as Key<E>];
      const name = this.resolveColumnName(key, field);
      ctx.append(this.escapeId(name) + direction);
    });
  }

  pager(ctx: QueryContext, opts: QueryPager): void {
    if (opts.$limit) {
      ctx.append(` LIMIT ${Number(opts.$limit)}`);
    }
    if (opts.$skip !== undefined) {
      ctx.append(` OFFSET ${Number(opts.$skip)}`);
    }
  }

  count<E>(ctx: QueryContext, entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): void {
    const search: Query<E> = { ...q };
    delete search.$sort;
    this.select<E>(ctx, entity, [raw('COUNT(*)', 'count')]);
    this.search(ctx, entity, search, opts);
  }

  /** `$group` aggregate operator → SQL function name. An allowlist, not a formatter: the op key
   * comes from query data, so anything outside this map must be rejected rather than passed
   * through as a raw SQL function name. */
  private static readonly AGGREGATE_FN_MAP = new Map<QueryAggregateOp, string>([
    ['$count', 'COUNT'],
    ['$sum', 'SUM'],
    ['$avg', 'AVG'],
    ['$min', 'MIN'],
    ['$max', 'MAX'],
  ]);

  aggregate<E, G extends QueryGroupMap<E>, A extends QueryAggMap<E>>(
    ctx: QueryContext,
    entity: Type<E>,
    q: QueryAggregate<E, G, A>,
    opts: QueryOptions = {},
  ): void {
    const meta = getMeta(entity);
    const tableName = this.resolveTableName(entity, meta);
    const groupKeys: string[] = [];
    const selectParts: string[] = [];
    const aggregateExpressions: Record<string, string> = {};

    for (const entry of parseGroupMap(q.$group, q.$agg)) {
      if (entry.kind === 'key') {
        const field = meta.fields[entry.alias as FieldKey<E>];
        const columnName = this.resolveColumnName(entry.alias, field);
        const escaped = this.escapeId(columnName);
        groupKeys.push(escaped);
        selectParts.push(columnName !== entry.alias ? `${escaped} ${this.escapeId(entry.alias)}` : escaped);
      } else {
        const sqlFn = AbstractSqlDialect.AGGREGATE_FN_MAP.get(entry.op);
        if (!sqlFn) {
          throw TypeError(`unsupported aggregate operator: ${entry.op}`);
        }
        const sqlArg = entry.fieldRef === '*' ? '*' : this.escapeId(this.columnOf(meta, entry.fieldRef));
        const expr = `${sqlFn}(${entry.distinct ? 'DISTINCT ' : ''}${sqlArg})`;
        aggregateExpressions[entry.alias] = expr;
        selectParts.push(`${expr} ${this.escapeId(entry.alias)}`);
      }
    }

    if (!selectParts.length) {
      throw new TypeError('aggregate requires at least one $group column or $agg function');
    }

    ctx.append(`SELECT ${selectParts.join(', ')} FROM ${this.escapeId(tableName)}`);
    this.where<E>(ctx, entity, q.$where, opts);

    if (groupKeys.length) {
      ctx.append(` GROUP BY ${groupKeys.join(', ')}`);
    }

    if (q.$having) {
      this.having(ctx, q.$having, aggregateExpressions);
    }

    this.aggregateSort(ctx, q.$sort, aggregateExpressions);
    this.pager(ctx, q);
  }

  /**
   * ORDER BY for aggregate queries - handles both entity-field and alias references.
   */
  private aggregateSort(
    ctx: QueryContext,
    sort: QuerySortMap<object> | undefined,
    aggregateExpressions: Record<string, string>,
  ): void {
    const sortMap = buildSortMap(sort);
    if (!hasKeys(sortMap)) return;

    ctx.append(' ORDER BY ');
    Object.entries(sortMap).forEach(([key, dir], index) => {
      if (index > 0) ctx.append(', ');
      const direction = this.resolveSortDirection(dir);
      const ref = aggregateExpressions[key] ?? this.escapeId(key);
      ctx.append(ref + direction);
    });
  }

  protected having(ctx: QueryContext, having: QueryHavingMap, aggregateExpressions: Record<string, string>): void {
    const entries = Object.entries(having).filter(([, v]) => v !== undefined);
    if (!entries.length) return;

    ctx.append(' HAVING ');
    entries.forEach(([alias, condition], index) => {
      if (index > 0) ctx.append(' AND ');
      const expr = aggregateExpressions[alias] ?? this.escapeId(alias);
      this.havingCondition(ctx, expr, condition);
    });
  }

  private static readonly SORT_DIRECTION_MAP = new Map<QuerySortDirection, string>([
    [1, ''],
    ['asc', ''],
    ['desc', ' DESC'],
    [-1, ' DESC'],
  ]);

  private resolveSortDirection(sort: unknown): string {
    const direction = AbstractSqlDialect.SORT_DIRECTION_MAP.get(sort as QuerySortDirection);
    if (direction === undefined) {
      throw TypeError(`unknown sort direction: ${sort}`);
    }
    return direction;
  }

  /** Scalar comparison operators shared by `HAVING` conditions and `$size` comparisons. */
  private static readonly comparisonOpMap = new Map<QueryHavingOp, string>([
    ['$eq', '='],
    ['$ne', '<>'],
    ['$gt', '>'],
    ['$gte', '>='],
    ['$lt', '<'],
    ['$lte', '<='],
  ]);

  protected havingCondition(ctx: QueryContext, expr: string, condition: QueryHavingMap[string]): void {
    if (typeof condition !== 'object' || condition === null) {
      ctx.append(`${expr} = `);
      ctx.addValue(condition);
      return;
    }
    const ops = condition as QueryWhereFieldOperatorMap<number>;
    const keys = getKeys(ops);
    keys.forEach((op, i) => {
      if (i > 0) ctx.append(' AND ');
      const val = ops[op];
      if (op === '$between') {
        const [min, max] = val as [number, number];
        ctx.append(`${expr} BETWEEN `);
        ctx.addValue(min);
        ctx.append(' AND ');
        ctx.addValue(max);
      } else if (op === '$in' || op === '$nin') {
        ctx.append(`${expr}${this.formatIn(ctx, Array.isArray(val) ? (val as unknown[]) : [], op === '$nin')}`);
      } else if (op === '$isNull') {
        ctx.append(`${expr}${val ? ' IS NULL' : ' IS NOT NULL'}`);
      } else if (op === '$isNotNull') {
        ctx.append(`${expr}${val ? ' IS NOT NULL' : ' IS NULL'}`);
      } else if (op === '$ne') {
        ctx.append(this.neExpr(expr, this.addValue(ctx.values, val)));
      } else {
        const sqlOp = AbstractSqlDialect.comparisonOpMap.get(op as QueryHavingOp);
        if (!sqlOp) throw TypeError(`unsupported HAVING operator: ${op}`);
        ctx.append(`${expr} ${sqlOp} `);
        ctx.addValue(val);
      }
    });
  }

  find<E>(ctx: QueryContext, entity: Type<E>, q: Query<E> = {}, opts?: QueryOptions): void {
    this.select(ctx, entity, q.$select, q.$exclude, q.$populate, opts, q.$distinct, q.$sort);
    this.search(ctx, entity, q, opts);
  }

  insert<E>(ctx: QueryContext, entity: Type<E>, payload: E | E[], opts?: QueryOptions): void {
    const meta = getMeta(entity);
    const payloads = fillOnFields(meta, payload, 'onInsert');
    const keys = getInsertFieldKeys(meta, payloads);

    // Resolve each key's field and escaped column once, then index into them: re-reading
    // `meta.fields[key]` per record cost 40 redundant lookups on a 10-row, 4-column insert.
    const width = keys.length;
    const fields: (FieldOptions | undefined)[] = new Array(width);
    const columns: string[] = new Array(width);
    for (let i = 0; i < width; i++) {
      const key = keys[i];
      fields[i] = meta.fields[key];
      columns[i] = this.escapedColumnName(meta, key);
    }

    const tableName = this.resolveTableName(entity, meta);
    ctx.append(`INSERT INTO ${this.escapeId(tableName)} (${columns.join(', ')}) VALUES (`);

    for (let r = 0; r < payloads.length; r++) {
      if (r > 0) {
        ctx.append('), (');
      }
      const record = payloads[r];
      for (let i = 0; i < width; i++) {
        if (i > 0) {
          ctx.append(', ');
        }
        const value = record[keys[i]];
        if (value === undefined) {
          this.appendDefaultInsertValue(ctx, fields[i]);
        } else {
          this.formatPersistableValue(ctx, fields[i], value);
        }
      }
    }
    ctx.append(')');
  }

  /**
   * Emit the value for a column a payload record does not provide (the column list is the union
   * across all records). `DEFAULT` delegates to the database default; SQLite overrides this since
   * it does not support the `DEFAULT` keyword inside `VALUES`.
   */
  protected appendDefaultInsertValue(ctx: QueryContext, _field: FieldOptions | undefined): void {
    ctx.append('DEFAULT');
  }

  update<E>(
    ctx: QueryContext,
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdatePayload<E>,
    opts?: QueryOptions,
  ): void {
    const meta = getMeta(entity);
    const [filledPayload] = fillOnFields(meta, payload as E, 'onUpdate');
    const keys = filterFieldKeys(meta, filledPayload, 'onUpdate');

    const tableName = this.resolveTableName(entity, meta);
    ctx.append(`UPDATE ${this.escapeId(tableName)} SET `);
    for (let i = 0; i < keys.length; i++) {
      if (i > 0) {
        ctx.append(', ');
      }
      const key = keys[i];
      const field = meta.fields[key];
      const escapedCol = this.escapedColumnName(meta, key);
      const value = filledPayload[key];

      if (isJsonUpdateOp(value)) {
        this.formatJsonUpdate(ctx, escapedCol, value, field);
      } else {
        ctx.append(`${escapedCol} = `);
        this.formatPersistableValue(ctx, field, value);
      }
    }

    this.search(ctx, entity, q, opts);
  }

  upsert<E>(ctx: QueryContext, entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E | E[]): void {
    const meta = getMeta(entity);
    const updateCtx = this.createContext();
    const update = this.getUpsertUpdateAssignments(
      updateCtx,
      meta,
      conflictPaths,
      payload,
      (name) => `VALUES(${name})`,
    );

    if (update) {
      this.insert(ctx, entity, payload);
      ctx.append(` ON DUPLICATE KEY UPDATE ${update}`);
      ctx.pushValue(...updateCtx.values);
    } else {
      const insertCtx = this.createContext();
      this.insert(insertCtx, entity, payload);
      ctx.append(insertCtx.sql.replace(/^INSERT/, 'INSERT IGNORE'));
      ctx.pushValue(...insertCtx.values);
    }
  }

  protected getUpsertUpdateAssignments<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: E | E[],
    callback?: (columnName: string) => string,
  ): string {
    const sample = Array.isArray(payload) ? payload[0] : payload;
    const cloned = { ...sample };
    const [filledPayload] = fillOnFields(meta, cloned, 'onUpdate');
    const fields = filterFieldKeys(meta, filledPayload, 'onUpdate');
    return fields
      .filter((col) => !conflictPaths[col])
      .map((col) => {
        const field = meta.fields[col];
        const columnName = this.resolveColumnName(col, field);
        if (callback && Object.hasOwn(sample as object, col)) {
          return `${this.escapeId(columnName)} = ${callback(this.escapeId(columnName))}`;
        }
        const text = this.buildFragment(ctx, (fragmentCtx) =>
          this.formatPersistableValue(fragmentCtx, field, filledPayload[col]),
        );
        return `${this.escapeId(columnName)} = ${text}`;
      })
      .join(', ');
  }

  protected getUpsertConflictPathsStr<E>(meta: EntityMeta<E>, conflictPaths: QueryConflictPaths<E>): string {
    return (getKeys(conflictPaths) as Key<E>[])
      .map((key) => {
        const field = meta.fields[key];
        const columnName = this.resolveColumnName(key, field);
        return this.escapeId(columnName);
      })
      .join(', ');
  }

  delete<E>(ctx: QueryContext, entity: Type<E>, q: QuerySearch<E>, opts: QueryOptions = {}): void {
    const meta = getMeta(entity);
    const tableName = this.resolveTableName(entity, meta);

    // Soft-delete (stamp only live rows) unless `hardDelete` is requested or the entity has no
    // soft-delete field (e.g. a cascade onto a non-soft-deletable child).
    if (!opts.hardDelete && meta.softDelete) {
      const field = meta.fields[meta.softDelete];
      if (field) {
        const columnName = this.resolveColumnName(meta.softDelete, field);
        ctx.append(`UPDATE ${this.escapeId(tableName)} SET ${this.escapeId(columnName)} = `);
        this.formatPersistableValue(ctx, field, getSoftDeleteValue(field));
        this.search(ctx, entity, q, opts);
        return;
      }
    }

    // Hard delete removes matching rows regardless of soft-delete state (keeps other filters, e.g. tenant).
    // Only rewrite the filters when there is a soft-delete filter to disable.
    ctx.append(`DELETE FROM ${this.escapeId(tableName)}`);
    this.search(ctx, entity, q, meta.softDelete ? { ...opts, filters: withoutSoftDeleteFilter(opts.filters) } : opts);
  }

  escapeId(val: string, forbidQualified?: boolean, addDot?: boolean): string {
    return escapeSqlId(val, this.escapeIdChar, forbidQualified, addDot);
  }

  /**
   * The single type dispatch for a persisted value. Dialects override {@link appendJsonValue} and
   * {@link appendVectorValue} rather than this, so the chain runs once per value - overriding this
   * and delegating back to `super` ran every check twice, measurably slowing every INSERT/UPDATE.
   */
  protected formatPersistableValue(ctx: QueryContext, field: FieldOptions | undefined, value: unknown): void {
    if (value instanceof QueryRaw) {
      this.getRawValue(ctx, { value });
      return;
    }
    const type = field?.type;
    if (isJsonType(type)) {
      this.appendJsonValue(ctx, value, type as JsonColumnType);
      return;
    }
    if (type === 'vector' && Array.isArray(value)) {
      this.appendVectorValue(ctx, value);
      return;
    }
    ctx.addValue(value);
  }

  protected appendJsonValue(ctx: QueryContext, value: unknown, _type: JsonColumnType): void {
    ctx.addValue(value == null ? null : JSON.stringify(value));
  }

  protected appendVectorValue(ctx: QueryContext, value: readonly unknown[]): void {
    ctx.addValue(`[${value.join(',')}]`);
  }

  /**
   * Reads `operand` as a JSON value. Passing the `?` placeholder yields the cast for a bound
   * parameter, and passing an expression re-reads text as JSON - the same SQL either way, which is
   * why this is one hook rather than a placeholder variant plus an expression variant.
   */
  protected jsonCast(operand: string): string {
    return `CAST(${operand} AS JSON)`;
  }

  /**
   * Generate the full `"col" = <expression>` assignment for a JSON update operator payload.
   * Called from `update()` when a field value is a {@link JsonUpdateOp}.
   *
   * Each operator wraps the expression built so far, innermost-first in the order stated on
   * {@link JsonUpdateOp} (`$pull` -> `$set` -> `$push` -> `$unset`), so dialects only supply the
   * four SQL fragments below. Two invariants keep every dialect consistent and keep bound values in
   * step with their placeholders:
   * - `$pull` is innermost and its subquery reads `escapedCol`, so its value binds exactly once.
   * - Later fragments reference `expr` at most once, so a `$pull` subquery is never duplicated
   *   (which would bind its value twice on positional-placeholder dialects). PostgreSQL's `$push`
   *   is the one exception, and is safe there because its placeholders are numbered.
   */
  protected formatJsonUpdate(ctx: QueryContext, escapedCol: string, value: JsonUpdateOp, field?: FieldOptions): void {
    // Centralizes the one narrowing cast: the payload's keys are typed against the entity's JSON
    // payload, which the dialects do not need - they only build SQL from keys and values.
    const { $pull, $set, $push, $unset } = value as JsonUpdateOperators;
    let expr = escapedCol;
    if (hasKeys($pull)) {
      expr = this.jsonPull(ctx, expr, escapedCol, $pull);
    }
    if (hasKeys($set)) {
      expr = this.jsonSet(ctx, expr, $set, field);
    }
    if (hasKeys($push)) {
      expr = this.jsonPush(ctx, expr, $push);
    }
    if ($unset?.length) {
      expr = this.jsonUnset(ctx, expr, $unset);
    }
    ctx.append(`${escapedCol} = ${expr}`);
  }

  /**
   * Remove every element equal to the given value, per array key. Each key wraps the expression
   * built so far, so dialects only supply {@link jsonPullKey} - and because every key reads
   * `escapedCol` rather than the accumulated expression, values bind once, in key order.
   */
  protected jsonPull(ctx: QueryContext, expr: string, escapedCol: string, pull: Record<string, unknown>): string {
    return Object.entries(pull).reduce((acc, [key, value]) => this.jsonPullKey(ctx, acc, escapedCol, key, value), expr);
  }

  /** Wrap `expr` so the array at `key` no longer contains `value`. */
  protected abstract jsonPullKey(
    ctx: QueryContext,
    expr: string,
    escapedCol: string,
    key: string,
    value: unknown,
  ): string;

  /** Shallow assignment of top-level keys, matching PostgreSQL's `jsonb || jsonb`. */
  protected abstract jsonSet(
    ctx: QueryContext,
    expr: string,
    set: Record<string, unknown>,
    field?: FieldOptions,
  ): string;

  /** Append one value per array key, creating the array when the key is absent. */
  protected abstract jsonPush(ctx: QueryContext, expr: string, push: Record<string, unknown>): string;

  /** Remove object keys. */
  protected abstract jsonUnset(ctx: QueryContext, expr: string, unset: readonly string[]): string;

  getRawValue(ctx: QueryContext, opts: QueryRawFnOptions & { value: QueryRaw; autoPrefixAlias?: boolean }) {
    const { value, prefix = '', escapedPrefix, autoPrefixAlias } = opts;
    const rawValue = value[RAW_VALUE];
    if (typeof rawValue === 'function') {
      const res = rawValue({
        ...opts,
        ctx,
        dialect: this,
        prefix,
        escapedPrefix: escapedPrefix ?? this.escapeId(prefix, true, true),
      });
      if (typeof res === 'string' || (typeof res === 'number' && !Number.isNaN(res))) {
        ctx.append(String(res));
      }
    } else {
      ctx.append(prefix + String(rawValue));
    }
    const alias = value[RAW_ALIAS];
    if (alias) {
      const fullAlias = autoPrefixAlias && prefix ? `${prefix}.${alias}` : alias;
      ctx.append(' ' + this.escapeId(fullAlias, true));
    }
  }

  /**
   * Resolves a dot-notation key to its JSON field metadata.
   * Shared by `where()` and `sort()` to detect 'column.path' keys where 'column' is a JSON/JSONB field.
   *
   * @returns resolved metadata or `undefined` if the key is not a JSON dot-notation path
   */
  protected resolveJsonDotPath<E>(
    meta: EntityMeta<E>,
    key: string,
    prefix?: string,
  ): { jsonPath: string; accessor: (asJsonb?: boolean) => string } | undefined {
    const dotIndex = key.indexOf('.');
    if (dotIndex <= 0) {
      return undefined;
    }
    const root = key.slice(0, dotIndex);
    const field = meta.fields[root as FieldKey<E>];
    if (!field || !isJsonType(field.type)) {
      return undefined;
    }
    const jsonPath = key.slice(dotIndex + 1);
    const colName = this.resolveColumnName(root, field);
    const escapedCol = (prefix ? this.escapeId(prefix, true, true) : '') + this.escapeId(colName);
    return {
      jsonPath,
      accessor: (asJsonb?: boolean) =>
        asJsonb ? this.getJsonPathJsonbExpr(escapedCol, jsonPath) : this.getJsonPathScalarExpr(escapedCol, jsonPath),
    };
  }

  /**
   * Compare a JSONB dot-notation path, e.g. `'settings.isArchived': { $ne: true }`.
   * Receives a pre-resolved `resolveJsonDotPath` result to avoid redundant computation.
   */
  protected compareJsonPath(
    ctx: QueryContext,
    resolved: {
      jsonPath: string;
      accessor: (asJsonb?: boolean) => string;
    },
    val: unknown,
  ): void {
    const { jsonPath, accessor } = resolved;
    const value = this.normalizeWhereValue(val);
    const operators = getKeys(value);

    if (operators.length > 1) {
      ctx.append('(');
    }

    operators.forEach((op, index) => {
      if (index > 0) ctx.append(' AND ');
      const asJson = this.isJsonbOp(op, value[op]);
      const sql = this.buildJsonFieldCondition(ctx, () => accessor(asJson), jsonPath, op, value[op], asJson);
      if (sql) {
        ctx.append(sql);
      }
    });

    if (operators.length > 1) {
      ctx.append(')');
    }
  }

  /**
   * Returns SQL that extracts a scalar value from a JSON path.
   * Dialects can override this to customize path access syntax while preserving
   * the shared comparison/operator pipeline.
   */
  protected getJsonPathScalarExpr(escapedColumn: string, jsonPath: string): string {
    const segments = jsonPath.split('.');
    let expr = escapedColumn;
    for (let i = 0; i < segments.length; i++) {
      const op = i === segments.length - 1 ? '->>' : '->';
      expr = `(${expr}${op}'${escapeSingleQuotes(segments[i])}')`;
    }
    return expr;
  }

  protected getJsonPathJsonbExpr(escapedColumn: string, jsonPath: string): string {
    const segments = jsonPath.split('.');
    let expr = escapedColumn;
    for (const segment of segments) {
      expr = `(${expr}->'${escapeSingleQuotes(segment)}')`;
    }
    return expr;
  }

  /**
   * Normalizes a raw WHERE value into an operator map.
   * Arrays become `$in`, scalars/null become `$eq`, objects pass through.
   */
  private normalizeWhereValue(val: unknown): Record<string, unknown> {
    if (Array.isArray(val)) return { $in: val };
    if (typeof val === 'object' && val !== null) return val as Record<string, unknown>;
    return { $eq: val };
  }

  /**
   * A field key's mapped column (`@Field({ name })`), escaped, memoized per dialect instance: field
   * metadata is shared between dialects while this result is not, since `escapeIdChar` and the naming
   * strategy differ. Weakly keyed so a transient entity's metadata stays collectable.
   */
  private escapedColumnName<E>(meta: EntityMeta<E>, key: string): string {
    const field = meta.fields[key];
    if (!field) {
      return this.escapeId(this.columnOf(meta, key));
    }
    let escaped = this.escapedColumns.get(field);
    if (escaped === undefined) {
      escaped = this.escapeId(this.columnOf(meta, key));
      this.escapedColumns.set(field, escaped);
    }
    return escaped;
  }

  private escapedColumn<E>(table: string, meta: EntityMeta<E>, key: string): string {
    return this.escapeId(table, false, true) + this.escapedColumnName(meta, key);
  }

  /** As {@link escapedColumn}, but qualified by the query alias when the parent is nested. */
  private escapedParentColumn<E>(
    parentTable: string,
    meta: EntityMeta<E>,
    opts: QueryComparisonOptions,
    key: string,
  ): string {
    return opts.prefix
      ? this.escapeId(opts.prefix, true, true) + this.escapedColumnName(meta, key)
      : this.escapedColumn(parentTable, meta, key);
  }

  /**
   * The single path from a relation operator to its target, so none can emit an unscoped subquery:
   * the target's `$where` is merged with its active filters, making a trashed or out-of-scope row
   * invisible here just as it is to a joined `$populate`. The caller's filter bypass is deliberately
   * not propagated (`withDeleted()` does not reach into relations), matching `selectRelationJoins`.
   */
  private appendRelationSubquery<E>(
    ctx: QueryContext,
    entity: Type<E>,
    key: string,
    rel: RelationOptions,
    opts: QueryComparisonOptions,
    projection: '1' | 'COUNT(*)',
    val: QueryWhereMap<unknown>,
  ): void {
    const meta = getMeta(entity);
    const parentTable = this.resolveTableName(entity, meta);
    if (!rel.references?.length) {
      throw new TypeError(`Relation '${key}' on '${parentTable}' has no references defined`);
    }
    const references = rel.references;
    const escapedParentId = this.escapedParentColumn(parentTable, meta, opts, meta.id);
    const relatedEntity = rel.entity!();
    const relatedMeta = getMeta(relatedEntity);
    const relatedTable = this.resolveTableName(relatedEntity, relatedMeta);
    // Resolved before any SQL is emitted: it also decides whether the mm form reaches the target.
    const targetWhere = this.scopedWhereMap(relatedMeta, val);

    ctx.append(`(SELECT ${projection} FROM `);

    if (rel.cardinality === 'mm' && rel.through) {
      const throughEntity = rel.through();
      const throughMeta = getMeta(throughEntity);
      const throughTable = this.resolveTableName(throughEntity, throughMeta);

      ctx.append(this.escapeId(throughTable));
      ctx.append(` WHERE ${this.escapedColumn(throughTable, throughMeta, references[0].local)} = ${escapedParentId}`);
      // The junction is a row being read too: a soft-deleted link is not a link.
      this.where(ctx, throughEntity, {}, { prefix: throughTable, clause: 'AND' });

      if (hasKeys(targetWhere)) {
        ctx.append(` AND ${this.escapedColumn(throughTable, throughMeta, references[1].local)} IN (`);
        ctx.append(
          `SELECT ${this.escapedColumn(relatedTable, relatedMeta, relatedMeta.id)} FROM ${this.escapeId(relatedTable)}`,
        );
        this.renderWhere(ctx, relatedEntity, targetWhere, { prefix: relatedTable, clause: 'WHERE' });
        ctx.append(')');
      }
    } else {
      const joinLeft = this.escapedColumn(relatedTable, relatedMeta, references[0].foreign);
      const joinRight =
        rel.cardinality === '1m'
          ? escapedParentId
          : this.escapedParentColumn(parentTable, meta, opts, references[0].local);

      ctx.append(this.escapeId(relatedTable));
      ctx.append(` WHERE ${joinLeft} = ${joinRight}`);
      this.renderWhere(ctx, relatedEntity, targetWhere, { prefix: relatedTable, clause: 'AND' });
    }

    ctx.append(')');
  }

  /** Filter by relation: a parent matches when {@link appendRelationSubquery} finds one target row. */
  protected compareRelation<E>(
    ctx: QueryContext,
    entity: Type<E>,
    key: string,
    val: QueryWhereMap<unknown>,
    rel: RelationOptions,
    opts: QueryComparisonOptions,
  ): void {
    ctx.append('EXISTS ');
    this.appendRelationSubquery(ctx, entity, key, rel, opts, '1', val);
  }

  /** Filter by relation size: the same subquery, counting instead of testing for existence. */
  protected compareRelationSize<E>(
    ctx: QueryContext,
    entity: Type<E>,
    key: string,
    sizeVal: number | QuerySizeComparisonOps,
    rel: RelationOptions,
    opts: QueryComparisonOptions,
  ): void {
    this.buildSizeComparison(
      ctx,
      () => this.appendRelationSubquery(ctx, entity, key, rel, opts, 'COUNT(*)', {}),
      sizeVal,
    );
  }

  /**
   * Build a complete `$size` comparison expression.
   * Handles both single and multiple comparison operators by repeating the size expression.
   * @param sizeExprFn - function that appends the size expression to ctx (e.g. `jsonb_array_length("col")`)
   */
  protected buildSizeComparison(
    ctx: QueryContext,
    sizeExprFn: () => void,
    sizeVal: number | QuerySizeComparisonOps,
  ): void {
    if (typeof sizeVal === 'number') {
      sizeExprFn();
      ctx.append(' = ');
      ctx.addValue(sizeVal);
      return;
    }

    const entries = Object.entries(sizeVal).filter(([, v]) => v !== undefined);

    if (entries.length > 1) {
      ctx.append('(');
    }

    entries.forEach(([op, val], index) => {
      if (index > 0) {
        ctx.append(' AND ');
      }
      sizeExprFn();
      this.appendSizeOp(ctx, op, val);
    });

    if (entries.length > 1) {
      ctx.append(')');
    }
  }

  /**
   * Append a single size comparison operator and value to the context.
   */
  private appendSizeOp(ctx: QueryContext, op: string, val: unknown): void {
    if (op === '$between') {
      const [min, max] = val as [number, number];
      ctx.append(' BETWEEN ');
      ctx.addValue(min);
      ctx.append(' AND ');
      ctx.addValue(max);
      return;
    }
    const sqlOp = AbstractSqlDialect.comparisonOpMap.get(op as QueryHavingOp);
    if (!sqlOp) {
      throw TypeError(`unsupported $size comparison operator: ${op}`);
    }
    ctx.append(` ${sqlOp} `);
    ctx.addValue(val);
  }

  /** ANSI-style single-quote escaping. MySQL-family dialects override this for backslash escaping. */
  escape(value: unknown): string {
    return escapeAnsiSqlLiteral(value);
  }

  protected get regexpOp(): string {
    return 'REGEXP';
  }

  protected get likeFn(): string {
    return 'LIKE';
  }

  /**
   * Not-equal operator token for non-null comparisons.
   * Postgres uses `IS DISTINCT FROM`; MySQL/Maria uses custom `neExpr`.
   */
  protected get neOp(): string {
    return '<>';
  }

  protected neExpr(field: string, ph: string): string {
    return `${field} ${this.neOp} ${ph}`;
  }

  protected ilikeExpr(f: string, ph: string): string {
    return `LOWER(${f}) LIKE ${ph}`;
  }

  /**
   * Formats an IN/NOT IN expression, binding each value individually.
   * Postgres overrides to use `= ANY($1)` / `<> ALL($1)` with a single array parameter.
   */
  protected formatIn(ctx: QueryContext, values: unknown[], negate: boolean): string {
    if (values.length === 0) return negate ? ' NOT IN (NULL)' : ' IN (NULL)';
    const phs = values.map((v) => this.addValue(ctx.values, v)).join(', ');
    return ` ${negate ? 'NOT IN' : 'IN'} (${phs})`;
  }

  protected numericCast(expr: string): string {
    return expr;
  }

  override toString(): string {
    return this.dialectName;
  }
}
