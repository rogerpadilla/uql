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
  parseQueryLock,
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
  type QueryLikeOp,
  type QueryNegateOp,
  type QueryOptions,
  type QueryPager,
  type QueryPopulate,
  QueryRaw,
  type QueryRawFnOptions,
  type QuerySearch,
  type QuerySelectOptions,
  type QuerySelectValue,
  type QuerySizeComparisonOps,
  type QuerySortDirection,
  type QuerySortMap,
  type QueryTextSearchOptions,
  type QueryWhere,
  type QueryWhereArray,
  type QueryWhereFieldOperatorMap,
  type QueryWhereMap,
  type QueryWhereOptions,
  RAW_ALIAS,
  RAW_VALUE,
  type RelationKey,
  type RelationMeta,
  type SqlDialectName,
  type SqlQueryDialect,
  type Type,
  type UpdatePayload,
} from '../type/index.js';
import {
  asSelectMap,
  buildQueryWhereAsMap,
  escapeSqlId,
  fillOnFields,
  filterFieldKeys,
  getInsertFieldKeys,
  getKeys,
  getSoftDeleteValue,
  hasKeys,
  isBooleanType,
  isJsonType,
  isJsonUpdateOp,
  isNumericType,
  isOperatorObject,
  isOperatorOnlyObject,
  isToManyRelation,
  isVectorSearch,
  normalizeScalarFieldSelection,
  parseGroupMap,
  parseRelationSize,
  populatesRelations,
  raw,
  someValue,
  withoutSoftDeleteFilter,
} from '../util/index.js';
import { escapeAnsiSqlLiteral, escapeSingleQuotes } from '../util/sqlLiteral.js';
import type { HydrateKind } from './hydrateColumn.js';
import { IndexSqlDialect } from './indexSqlDialect.js';
import { buildElemMatchConditions } from './jsonArrayElemMatchUtils.js';
import { isJsonbOp, JSON_ELEM_ALIAS_PREFIX, jsonCompareMode, jsonElemExists } from './jsonSql.js';
import { SqlQueryContext } from './queryContext.js';
import {
  isSortMap,
  NO_JOINS,
  type QueryJoin,
  type QueryJoins,
  type QuerySortOptions,
  resolveQueryJoins,
} from './queryJoins.js';
import { isVectorFieldType, resolveVectorCast } from './vectorCast.js';

/** {@link JsonUpdateOp} as the dialects consume it: plain keys and values, no entity typing. */
type JsonUpdateOperators = {
  readonly $set?: Record<string, unknown>;
  readonly $unset?: readonly string[];
  readonly $push?: Record<string, unknown>;
  readonly $pull?: Record<string, unknown>;
};

/** How a column's values are bound: see {@link AbstractSqlDialect.persistKind}. */
type PersistKind = 'plain' | 'json' | 'vector';

/** One entry of {@link AbstractSqlDialect.LIKE_OPS}: how the pattern is built, and whether it ignores case. */
type LikeOp = { readonly pattern: (value: string) => string; readonly insensitive: boolean };

/** One entry of {@link AbstractSqlDialect.hydratableFields}: a field key and how it decodes. */
type HydratableField = readonly [string, HydrateKind];

export type { HydrateKind };

export abstract class AbstractSqlDialect extends IndexSqlDialect implements QueryDialect, SqlQueryDialect {
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
   * bound value on `$n`-placeholder dialects once `ctx` isn't otherwise empty. Generated aliases are
   * shared for the same reason - see {@link SqlQueryContext}.
   */
  protected buildFragment(ctx: QueryContext, build: (fragmentCtx: QueryContext) => void): string {
    const fragmentCtx = ctx.createFragment();
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

  search<E>(ctx: QueryContext, entity: Type<E>, q: Query<E> = {}, opts: QueryOptions = {}, joins = NO_JOINS): void {
    const meta = getMeta(entity);
    const tableName = this.resolveTableName(entity, meta);
    const prefix = this.resolveRelationAwarePrefix(tableName, meta, opts, q.$populate, joins);
    if (opts.prefix !== prefix) {
      opts = { ...opts, prefix };
    }
    this.where<E>(ctx, entity, q.$where, opts);
    this.sort<E>(ctx, entity, q.$sort, { prefix, joins, distinct: q.$distinct });
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
    const escapedPrefix = this.escapeId(opts.prefix, true, true);

    const scalars: (FieldKey<E> | QueryRaw)[] = Array.isArray(select)
      ? select // raw SQL projections passed as QueryRaw[]
      : normalizeScalarFieldSelection(meta, asSelectMap(select), exclude);

    // A prefix means relations are in play: rows arrive keyed by the id and `fillToManyRelations`
    // groups children by it, so it outlives any subtraction - `$exclude` or falsy `$select` alike.
    const id = meta.id;
    const selectArr = id && opts.prefix && !scalars.includes(id) ? [id, ...scalars] : scalars;

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
        if (field.virtual) {
          this.getRawValue(ctx, {
            value: raw(field.virtual[RAW_VALUE], key),
            prefix: opts.prefix,
            escapedPrefix,
            autoPrefixAlias: opts.autoPrefixAlias,
          });
          return;
        }
        const columnName = this.resolveColumnName(key, field);
        const column = escapedPrefix + this.escapeId(columnName);
        const expr = this.selectFieldExpr(column, field);
        ctx.append(expr);
        // An expression needs the alias too, or the row comes back keyed by the expression text.
        if (expr !== column || columnName !== key || opts.autoPrefixAlias) {
          ctx.append(' ' + this.escapeId(prefix + key, true));
        }
      }
    });
  }

  /**
   * The expression a scalar field is read through, the plain column by default. MariaDB reads a
   * vector column back with `VEC_ToText`, since selecting it raw yields its binary form.
   */
  protected selectFieldExpr(escapedColumn: string, _field: FieldOptions): string {
    return escapedColumn;
  }

  /**
   * The `$text` full-text predicate, which every engine spells differently: `MATCH ... AGAINST`
   * (MySQL family), `to_tsvector @@ websearch_to_tsquery` (Postgres-wire), an FTS5 `MATCH` against
   * the table itself (SQLite). No portable form exists, so a dialect without one says so here rather
   * than inheriting another engine's syntax.
   */
  protected appendTextSearch<E>(
    _ctx: QueryContext,
    _entity: Type<E>,
    _meta: EntityMeta<E>,
    _search: QueryTextSearchOptions<E>,
  ): void {
    throw new TypeError(`${this.dialectName} does not support $text full-text search`);
  }

  select<E>(ctx: QueryContext, entity: Type<E>, q: Query<E>, opts: QueryOptions = {}, joins = NO_JOINS): void {
    const meta = getMeta(entity);
    const tableName = this.resolveTableName(entity, meta);
    const prefix = this.resolveRelationAwarePrefix(tableName, meta, opts, q.$populate, joins);

    ctx.append(q.$distinct ? 'SELECT DISTINCT ' : 'SELECT ');
    this.selectFields(ctx, entity, q.$select, { prefix }, q.$exclude);
    // Add related fields BEFORE FROM clause
    this.selectRelationFields(ctx, joins);
    // Inject vector distance projections when $project is set
    for (const [key, val] of Object.entries(q.$sort ?? {})) {
      if (isVectorSearch(val) && val.$project) {
        ctx.append(', ');
        this.appendVectorProjection(ctx, meta, key, val);
      }
    }
    ctx.append(` FROM ${this.escapeId(tableName)}`);
    // Add JOINs AFTER FROM clause
    this.selectRelationJoins(ctx, meta, tableName, joins);
  }

  /** Columns are alias-qualified once anything else is in play: a join, or a to-many being filled. */
  private resolveRelationAwarePrefix<E>(
    tableName: string,
    meta: EntityMeta<E>,
    opts: QueryOptions,
    populate: QueryPopulate<E> | undefined,
    joins: QueryJoins,
  ): string | undefined {
    return (opts.prefix ?? (opts.autoPrefix || joins.size > 0 || populatesRelations(meta, populate)))
      ? tableName
      : undefined;
  }

  protected selectRelationFields(ctx: QueryContext, joins: QueryJoins): void {
    for (const join of joins.values()) {
      // A join `$sort` asked for adds no columns: it orders the rows, it does not widen them.
      if (!join.projected) continue;
      ctx.append(', ');
      this.selectFields(
        ctx,
        join.entity,
        join.query.$select,
        { prefix: join.path, autoPrefixAlias: true },
        join.query.$exclude,
      );
    }
  }

  protected selectRelationJoins<E>(ctx: QueryContext, meta: EntityMeta<E>, tableName: string, joins: QueryJoins): void {
    for (const join of joins.values()) {
      const joinAlias = this.escapeId(join.path, true);
      const parentAlias = join.parent ? this.escapeId(join.parent.path, true) : this.escapeId(tableName);

      ctx.append(
        ` ${join.required ? 'INNER' : 'LEFT'} JOIN ${this.escapeId(this.resolveTableName(join.entity, join.meta))} ${joinAlias} ON `,
      );
      join.relation.references.forEach((reference, index) => {
        if (index > 0) ctx.append(' AND ');
        const foreign = this.escapeId(this.columnOf(join.meta, reference.foreign));
        // Two calls rather than one over a union: the parent is either another join's entity or the
        // queried one, and their metadata types have nothing in common.
        const local = this.escapeId(
          join.parent ? this.columnOf(join.parent.meta, reference.local) : this.columnOf(meta, reference.local),
        );
        ctx.append(`${joinAlias}.${foreign} = ${parentAlias}.${local}`);
      });

      // Unconditional, not gated by `join.query.$where`: a joined relation's own filters (in
      // particular `security: true` ones) must apply even to a bare `$populate: { rel: true }`
      // with no explicit `$where` - and equally to a join `$sort` brought in on its own.
      // `where()` -> `renderWhere()` no-ops cleanly (appends nothing) when there is nothing to add.
      this.where(ctx, join.entity, join.query.$where ?? {}, { prefix: join.path, clause: 'AND' });
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
    const { clause = 'WHERE' } = opts;

    where = buildQueryWhereAsMap(meta, where);

    // An `undefined` value emits nothing, so it must not count towards the terms either: it decides
    // both where the `AND`s go and whether this fragment needs parentheses.
    const whereKeys = getKeys(where).filter((key) => (where as Record<string, unknown>)[key] !== undefined);

    if (!whereKeys.length) {
      return;
    }

    if (clause) {
      ctx.append(` ${clause} `);
    }

    const multipleKeys = whereKeys.length > 1;
    // This fragment joins its own keys with `AND`, so appending it after one (a JOIN's `ON`) needs no
    // parentheses - but anything nested in it is still an operand, since that may be an `OR`.
    const parenthesize = multipleKeys && opts.operand;

    if (parenthesize) {
      ctx.append('(');
    }

    // Each key is an operand of the `AND` joining them; a lone key emits this fragment verbatim, so
    // it inherits this one's position instead.
    const childOperand = multipleKeys || opts.operand || clause === 'AND';
    const childOpts = opts.operand === childOperand ? opts : { ...opts, operand: childOperand };
    whereKeys.forEach((key, index) => {
      if (index > 0) {
        ctx.append(' AND ');
      }
      this.compare(ctx, entity, key, (where as Record<string, unknown>)[key], childOpts);
    });

    if (parenthesize) {
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
      this.appendTextSearch(ctx, entity, meta, val as QueryTextSearchOptions<E>);
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
        this.compareRelationSize(ctx, entity, sizeVal, rel, opts);
        return;
      }
      this.compareRelation(ctx, entity, val as QueryWhereMap<unknown>, rel, opts);
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
    const negate = AbstractSqlDialect.NEGATE_OP_MAP.has(key as QueryNegateOp);

    const items = val ?? [];
    // With more than one item each is an operand of the operator joining them, so a compound item
    // parenthesizes itself and precedence never applies; a lone item is this group verbatim, so it
    // inherits the group's own position. A negation always makes its subject an operand.
    const childOperand = items.length > 1 || negate || opts.operand;

    // Rendered before anything is appended, because an item that contributes no SQL (`{}`, an
    // `undefined` entry) must leave no dangling separator behind, and how many terms this fragment
    // really emits is what decides whether it needs parentheses.
    const parts = items
      .map((entry) =>
        this.buildFragment(ctx, (fragmentCtx) => {
          if (entry instanceof QueryRaw) {
            this.getRawValue(fragmentCtx, { value: entry });
          } else if (entry) {
            this.renderWhere(fragmentCtx, entity, entry, { prefix: opts.prefix, operand: childOperand, clause: false });
          }
        }),
      )
      .filter((part) => part !== '');

    if (!parts.length) {
      return;
    }

    const body = parts.join(op === '$or' ? ' OR ' : ' AND ');
    const parenthesize = parts.length > 1 && (opts.operand || negate);
    ctx.append((negate ? 'NOT ' : '') + (parenthesize ? `(${body})` : body));
  }

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

  /**
   * Every `$like`-family operator: the pattern it wraps its value in, and whether it ignores case.
   * Each case-sensitive operator is paired here with the `$i` twin that shares its pattern, so the
   * two can never drift apart - and neither one decides case folding, which is
   * {@link caseInsensitiveMatch}'s single call.
   */
  private static readonly LIKE_OPS: ReadonlyMap<string, LikeOp> = new Map(
    (
      [
        ['$like', '$ilike', (v: string) => v],
        ['$startsWith', '$istartsWith', (v: string) => `${v}%`],
        ['$endsWith', '$iendsWith', (v: string) => `%${v}`],
        ['$includes', '$iincludes', (v: string) => `%${v}%`],
      ] satisfies readonly [QueryLikeOp, QueryLikeOp, (v: string) => string][]
    ).flatMap(([sensitive, insensitive, pattern]): [string, LikeOp][] => [
      [sensitive, { pattern, insensitive: false }],
      [insensitive, { pattern, insensitive: true }],
    ]),
  );

  /**
   * How this engine matches case-insensitively. One decision, not two: folding the pattern while the
   * comparison leaves the column alone matches neither case, which is what `$istartsWith: 'Some'`
   * used to do wherever `LIKE` is case-sensitive.
   *
   * - `ilike`: the engine has a case-insensitive operator (`ILIKE`), so the pattern goes through as written.
   * - `native`: plain `LIKE` already ignores case (SQLite, for ASCII). Folding the pattern in JS would
   *   only break the non-ASCII characters the engine cannot fold anyway - `'É'` would become an `'é'`
   *   that matches nothing.
   * - `fold`: nothing ignores case on its own, so both sides are lowered explicitly. Not indexable as
   *   such; an expression index over `LOWER(column)` is what makes it so.
   */
  protected readonly caseInsensitiveMatch: 'ilike' | 'native' | 'fold' = 'fold';

  /**
   * A `$like`-family condition, or `undefined` when `op` is not one of them. Shared by columns and
   * JSON paths, and the only place a pattern is folded - always together with the column it is
   * compared against.
   */
  protected likeCondition(ctx: QueryContext, operand: string, op: string, val: unknown): string | undefined {
    const like = AbstractSqlDialect.LIKE_OPS.get(op);
    if (!like) {
      return undefined;
    }
    const fold = like.insensitive && this.caseInsensitiveMatch === 'fold';
    const value = String(val);
    const ph = this.addValue(ctx.values, like.pattern(fold ? value.toLowerCase() : value));
    const matchOp = like.insensitive && this.caseInsensitiveMatch === 'ilike' ? 'ILIKE' : this.likeFn;
    return `${fold ? `LOWER(${operand})` : operand} ${matchOp} ${ph}`;
  }

  /** Builds `prefix.column` from an already-resolved field, through the same memo writes use. */
  private columnWithPrefix(key: string, field: FieldOptions | undefined, prefix: string | undefined): string {
    return this.escapeId(prefix, true, true) + this.escapedColumnOf(key, field);
  }

  /**
   * The SQL a field comparison reads its left-hand side from. A virtual field builds its expression
   * as text rather than appending it, so every operator gets a real operand to wrap - `LOWER(...)`,
   * `NOT (... <=> ...)` - instead of having to fall back to a form that takes none.
   */
  protected resolveOperandField<E>(ctx: QueryContext, entity: Type<E>, key: string, opts: QueryOptions): string {
    const field = getMeta(entity).fields[key];
    const virtual = field?.virtual;
    if (virtual) {
      return this.buildFragment(ctx, (fragmentCtx) =>
        this.getRawValue(fragmentCtx, {
          value: virtual,
          prefix: opts.prefix,
          escapedPrefix: this.escapeId(opts.prefix, true, true),
        }),
      );
    }
    return this.columnWithPrefix(key, field, opts.prefix);
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

    if (this.appendOperatorCondition(ctx, field, op as string, val)) {
      return;
    }

    switch (op) {
      case '$not':
        ctx.append('NOT (');
        this.compare(ctx, entity, key as keyof QueryWhereMap<E>, val as QueryWhereMap<E>[keyof QueryWhereMap<E>], opts);
        ctx.append(')');
        break;
      case '$all':
        ctx.append(this.jsonAll(ctx, field, val));
        break;
      case '$size':
        ctx.append(this.jsonSize(ctx, field, val as number | QuerySizeComparisonOps));
        break;
      case '$elemMatch':
        ctx.append(this.jsonElemMatch(ctx, field, val as Record<string, unknown>));
        break;
      default:
        throw TypeError(`unknown operator: ${op}`);
    }
  }

  /**
   * `<operand> <op> <value>` for every operator that needs nothing but its left-hand SQL, or
   * `undefined` when `op` is not one of them.
   *
   * One implementation for three callers that each had their own: a WHERE column, a HAVING aggregate
   * expression, and a `$size` count (whose expression is already in the context, so it passes an
   * empty operand). They previously disagreed - HAVING carried a second comparison-operator map and
   * threw `unsupported HAVING operator` on the `$like` that `QueryHavingMap` accepts, and neither of
   * the other two turned `$eq: null` into `IS NULL` the way the WHERE path does.
   *
   * The operators kept out are the ones that need more than an operand: `$not` recurses through the
   * entity, and `$all`/`$size`/`$elemMatch` address a JSON document.
   */
  protected operatorCondition(ctx: QueryContext, operand: string, op: string, val: unknown): string | undefined {
    const compareOp = AbstractSqlDialect.COMPARE_OP_MAP.get(op as QueryCompareOp);
    if (compareOp) {
      return `${operand}${compareOp}${this.addValue(ctx.values, val)}`;
    }

    const like = this.likeCondition(ctx, operand, op, val);
    if (like) {
      return like;
    }

    switch (op) {
      case '$eq':
        return val === null ? `${operand} IS NULL` : `${operand} = ${this.addValue(ctx.values, val)}`;
      case '$ne':
        return val === null ? `${operand} IS NOT NULL` : this.neExpr(operand, this.addValue(ctx.values, val));
      case '$regex':
        return `${operand} ${this.regexpOp} ${this.addValue(ctx.values, val)}`;
      case '$in':
      case '$nin': {
        if (!Array.isArray(val)) {
          // Not covered by the types: `/http` casts client JSON straight to `Query`, so this arrives untyped.
          throw TypeError(`${op} expects an array, got ${val === null ? 'null' : typeof val}`);
        }
        return operand + this.formatIn(ctx, val, op === '$nin');
      }
      case '$between': {
        const [min, max] = val as [unknown, unknown];
        return `${operand} BETWEEN ${this.addValue(ctx.values, min)} AND ${this.addValue(ctx.values, max)}`;
      }
      case '$isNull':
        return operand + (val ? ' IS NULL' : ' IS NOT NULL');
      case '$isNotNull':
        return operand + (val ? ' IS NOT NULL' : ' IS NULL');
      default:
        return undefined;
    }
  }

  /** {@link operatorCondition}, appended; `false` when `op` needs more than an operand. */
  protected appendOperatorCondition(ctx: QueryContext, operand: string, op: string, val: unknown): boolean {
    const condition = this.operatorCondition(ctx, operand, op, val);
    if (condition === undefined) {
      return false;
    }
    ctx.append(condition);
    return true;
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
    // The `$like` family reads a JSON path exactly as it reads a column, case folding included.
    const like = this.likeCondition(ctx, jsonField, op, value);
    if (like) {
      return like;
    }
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
    return jsonCompareMode(value) === 'numeric' ? this.numericCast(jsonField) : jsonField;
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
      const asJson = !this.jsonScalarElemKeepsType && entries.every(([op, val]) => isJsonbOp(op, val));
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
      const asJson = isJsonbOp(op, opVal);
      return this.buildJsonFieldCondition(ctx, (f) => this.jsonElemRef(alias, f, asJson), field, op, opVal, asJson);
    });
    return jsonElemExists(this.jsonElemFrom(jsonField, Object.keys(match), alias), conditions);
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

  /** {@link resolveOperandField}, appended. */
  getComparisonKey<E>(ctx: QueryContext, entity: Type<E>, key: FieldKey<E>, opts: QueryOptions = {}): void {
    ctx.append(this.resolveOperandField(ctx, entity, key, opts));
  }

  sort<E>(ctx: QueryContext, entity: Type<E>, sort: QuerySortMap<E> | undefined, opts: QuerySortOptions = {}): void {
    if (!hasKeys(sort)) {
      return;
    }
    // Collected before anything is appended so an unorderable key is reported instead of half a
    // clause, and because a vector distance is the primary ordering wherever it appears in the map.
    const vectors: string[] = [];
    const columns: string[] = [];
    this.collectSortTerms(ctx, getMeta(entity), sort, opts, vectors, columns);

    const terms = [...vectors, ...columns];
    if (terms.length) {
      ctx.append(` ORDER BY ${terms.join(', ')}`);
    }
  }

  /**
   * Walks `$sort` against the metadata of the entity each level addresses, rather than flattening it
   * to dotted strings and reading every key off the root: only that way does a related column resolve
   * through its own `@Field({ name })`, and only that way is `tax.category` the one alias the join
   * carries instead of two quoted identifiers.
   */
  private collectSortTerms<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    sort: QuerySortMap<E>,
    opts: QuerySortOptions,
    vectors: string[],
    columns: string[],
    path = '',
  ): void {
    // Below the first level the alias a column is qualified by *is* the path walked to reach it.
    const prefix = path || opts.prefix;

    for (const [key, value] of Object.entries(sort)) {
      const relation = meta.relations[key as RelationKey<E>];
      if (relation) {
        const relPath = path ? `${path}.${key}` : key;
        if (!isSortMap(value)) {
          throw new TypeError(`$sort by relation '${relPath}' expects a map of its fields, got ${String(value)}`);
        }
        const join = this.resolveSortJoin(relation, relPath, opts);
        this.collectSortTerms(ctx, join.meta, value, opts, vectors, columns, relPath);
        continue;
      }
      if (isVectorSearch(value)) {
        if (path) {
          throw new TypeError(`$vector sort is only supported on the queried entity, not on relation '${path}'`);
        }
        // Already projected in the SELECT list: order by that alias rather than recomputing it.
        vectors.push(
          value.$project
            ? this.escapeId(value.$project)
            : this.buildFragment(ctx, (fragmentCtx) => this.appendVectorSort(fragmentCtx, meta, key, value)),
        );
        continue;
      }
      columns.push(this.sortColumn(meta, key, prefix) + this.resolveSortDirection(value));
    }
  }

  /** The join an `ORDER BY` term addresses, or why the statement cannot order by it. */
  private resolveSortJoin(relation: RelationMeta, path: string, opts: QuerySortOptions): QueryJoin {
    if (isToManyRelation(relation)) {
      throw new TypeError(
        `cannot $sort by '${path}': a parent has many of them, so there is no single value to order by. Sort the relation's own rows inside $populate instead.`,
      );
    }
    const join = opts.joins?.get(path);
    if (!join) {
      throw new TypeError(`cannot $sort by relation '${path}': this statement joins no relations`);
    }
    // `SELECT DISTINCT` can only order by what it selected, on every engine here, so a join brought in
    // for the sort alone has nothing to order by. Populating it puts its columns in the select list.
    if (opts.distinct && !join.projected) {
      throw new TypeError(
        `cannot $sort by relation '${path}' with $distinct unless '${path}' is populated: SELECT DISTINCT orders only by selected columns`,
      );
    }
    return join;
  }

  /**
   * The `ORDER BY` operand for one key. A key that is not a column of `meta` - a virtual field, a
   * `raw()` projection - is an output alias, which is never table-qualified and needs no resolving.
   */
  private sortColumn<E>(meta: EntityMeta<E>, key: string, prefix: string | undefined): string {
    const field = meta.fields[key as FieldKey<E>];
    if (field) {
      return field.virtual ? this.escapeId(key) : this.columnWithPrefix(key, field, prefix);
    }
    return this.resolveJsonDotPath(meta, key, prefix)?.accessor() ?? this.escapeId(key);
  }

  pager(ctx: QueryContext, opts: QueryPager): void {
    if (opts.$limit) {
      ctx.append(` LIMIT ${Number(opts.$limit)}`);
    }
    if (opts.$skip !== undefined) {
      ctx.append(` OFFSET ${Number(opts.$skip)}`);
    }
  }

  /** Whether this engine has row locks at all. The SQLite family locks the database instead. */
  readonly supportsRowLocks: boolean = true;

  /** MariaDB is the one engine here that cannot narrow a lock to one table of a join. */
  readonly supportsLockOf: boolean = true;

  /** Validated before the querier checks for a transaction, so the clearer error wins. */
  assertLockSupported<E>(entity: Type<E>, q: Query<E>, joins?: QueryJoins): void {
    if (!parseQueryLock(q.$lock)) {
      return;
    }
    if (!this.supportsRowLocks) {
      throw new TypeError(`${this.dialectName} does not support row-level locking ($lock)`);
    }
    joins ??= resolveQueryJoins(getMeta(entity), q);
    if (!this.supportsLockOf && joins.size > 0) {
      throw new TypeError(
        `${this.dialectName} cannot narrow a row lock to one table, so $lock cannot be combined with a joined relation`,
      );
    }
  }

  /**
   * The trailing `FOR UPDATE`. Narrowing to the queried table is not a nicety once a relation is
   * joined: Postgres refuses a bare `FOR UPDATE` over the nullable side of an outer join outright,
   * and the other engines quietly widen the lock to the joined rows.
   */
  protected appendLock<E>(ctx: QueryContext, entity: Type<E>, q: Query<E>, joins = NO_JOINS): void {
    const wait = parseQueryLock(q.$lock);
    if (!wait) {
      return;
    }
    this.assertLockSupported(entity, q, joins);
    const meta = getMeta(entity);
    const target = joins.size > 0 ? ` OF ${this.escapeId(this.resolveTableName(entity, meta))}` : '';
    const suffix = wait === 'skip' ? ' SKIP LOCKED' : wait === 'nowait' ? ' NOWAIT' : '';
    ctx.append(` FOR UPDATE${target}${suffix}`);
  }

  count<E>(ctx: QueryContext, entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): void {
    const search: Query<E> = { ...q };
    // A count joins nothing and orders nothing: how many rows match is the same either way.
    delete search.$sort;
    this.select<E>(ctx, entity, { $select: [raw('COUNT(*)', 'count')] });
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

    this.aggregateSort(ctx, meta, q.$sort, aggregateExpressions);
    this.pager(ctx, q);
  }

  /**
   * ORDER BY for aggregate queries - handles both entity-field and alias references. A grouped
   * statement has no joins to address, so a relation key is rejected rather than emitted as an alias
   * nothing defines.
   */
  private aggregateSort<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    sort: QuerySortMap<object> | undefined,
    aggregateExpressions: Record<string, string>,
  ): void {
    if (!hasKeys(sort)) return;

    ctx.append(' ORDER BY ');
    Object.entries(sort).forEach(([key, dir], index) => {
      if (index > 0) ctx.append(', ');
      if (meta.relations[key as RelationKey<E>]) {
        throw new TypeError(`cannot $sort by relation '${key}' in an aggregate query: it groups rows, it joins none`);
      }
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
  protected havingCondition(ctx: QueryContext, expr: string, condition: QueryHavingMap[string]): void {
    if (typeof condition !== 'object' || condition === null) {
      this.appendOperatorCondition(ctx, expr, '$eq', condition);
      return;
    }
    const ops = condition as QueryWhereFieldOperatorMap<number>;
    getKeys(ops).forEach((op, i) => {
      if (i > 0) ctx.append(' AND ');
      if (!this.appendOperatorCondition(ctx, expr, op, ops[op])) {
        throw TypeError(`unsupported HAVING operator: ${op}`);
      }
    });
  }

  find<E>(ctx: QueryContext, entity: Type<E>, q: Query<E> = {}, opts?: QueryOptions): void {
    // The one statement that can join, so the one that resolves the join set; everything else renders
    // against `NO_JOINS` and rejects a `$sort` that would need one.
    const joins = resolveQueryJoins(getMeta(entity), q);
    this.select(ctx, entity, q, opts, joins);
    this.search(ctx, entity, q, opts, joins);
    // Appended here rather than in `search`, which `count`/`update`/`delete` share: a lock belongs
    // to a SELECT alone. Every engine spells it after LIMIT/OFFSET, so it goes last.
    this.appendLock(ctx, entity, q, joins);
  }

  insert<E>(ctx: QueryContext, entity: Type<E>, payload: E | E[], opts?: QueryOptions): void {
    this.appendInsertValues(ctx, entity, payload, opts);

    // Every engine whose ids come back from the statement itself wants the same clause, so it is
    // appended once here instead of in an identical `insert` override per dialect.
    if (this.insertIdSource === 'returning') {
      ctx.append(` ${this.returningId(entity)}`);
    }
  }

  /**
   * `INSERT INTO ... VALUES (...)` and nothing more. The upsert builders extend this rather than
   * {@link insert}: their own clause has to come before the `RETURNING`, not after it.
   */
  protected appendInsertValues<E>(ctx: QueryContext, entity: Type<E>, payload: E | E[], opts?: QueryOptions): void {
    const meta = getMeta(entity);
    const payloads = fillOnFields(meta, payload, 'onInsert');
    const keys = getInsertFieldKeys(meta, payloads);

    // Resolve each key's field and escaped column once, then index into them: re-reading
    // `meta.fields[key]` per record cost 40 redundant lookups on a 10-row, 4-column insert.
    const width = keys.length;
    const fields: (FieldOptions | undefined)[] = new Array(width);
    const columns: string[] = new Array(width);
    const kinds: PersistKind[] = new Array(width);
    for (let i = 0; i < width; i++) {
      const key = keys[i];
      const field = meta.fields[key];
      fields[i] = field;
      columns[i] = this.escapedColumnName(meta, key);
      kinds[i] = this.persistKind(field);
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
        } else if (kinds[i] === 'plain' && !(value instanceof QueryRaw)) {
          // The overwhelmingly common case in a bulk insert, so it binds without a dispatch.
          ctx.addValue(value);
        } else {
          this.writePersistableValue(ctx, kinds[i], fields[i], value);
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

  /**
   * `INSERT ... ON CONFLICT (...) DO UPDATE/NOTHING RETURNING ...`, which SQLite adopted from Postgres
   * and which every dialect here speaks except the MySQL family (see {@link MysqlLikeSqlDialect}).
   *
   * Two orderings matter, and they pull in opposite directions. The assignments are computed *before*
   * the insert, because `appendInsertValues` fills `onInsert` fields into the payload and a column that
   * exists only there - `createdAt` - must not join the update set. Their bound values are pushed
   * *after* it, because a `?` placeholder is positional and the clause comes last in the statement.
   * {@link PgLikeSqlDialect} overrides this: `$N` placeholders make array order irrelevant, so it can
   * bind into the main context and skip the second one.
   */
  upsert<E>(
    ctx: QueryContext,
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: E | E[],
    extraReturning = '',
  ): void {
    const meta = getMeta(entity);
    const updateCtx = this.upsertUpdateBindsInPlace ? ctx : this.createContext();
    const update = this.getUpsertUpdateAssignments(updateCtx, meta, conflictPaths, payload, this.upsertExcluded);
    const keys = this.getUpsertConflictPathsStr(meta, conflictPaths);
    const onConflict = update ? `DO UPDATE SET ${update}` : 'DO NOTHING';
    this.appendInsertValues(ctx, entity, payload);
    ctx.append(` ON CONFLICT (${keys}) ${onConflict} ${this.returningId(entity)}${extraReturning}`);
    if (updateCtx !== ctx) {
      ctx.pushValue(...updateCtx.values);
    }
  }

  /**
   * Whether the upsert's update assignments can bind straight into the statement's own context.
   *
   * They cannot on a `?`-placeholder dialect: the assignments are built before the insert but read
   * after it, so their values have to be pushed afterwards to land in the right positional order.
   * A `$n` placeholder carries its own index, so there is nothing to reorder - but it also cannot use
   * the scratch context, whose numbering would restart at `$1` and collide with the insert's.
   */
  protected readonly upsertUpdateBindsInPlace: boolean = false;

  /** How an `ON CONFLICT` assignment reads the row that was being inserted. */
  protected readonly upsertExcluded = (columnName: string): string => `EXCLUDED.${columnName}`;

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

  escapeId(val: string | undefined, forbidQualified?: boolean, addDot?: boolean): string {
    return escapeSqlId(val, this.escapeIdChar, forbidQualified, addDot);
  }

  /**
   * Bind one persisted value, classifying its column on the spot. Dialects override
   * {@link appendJsonValue} and {@link appendVectorValue} rather than this, so the chain runs once per
   * value - overriding this and delegating back to `super` ran every check twice, measurably slowing
   * every INSERT/UPDATE.
   */
  protected formatPersistableValue(ctx: QueryContext, field: FieldOptions | undefined, value: unknown): void {
    this.writePersistableValue(ctx, this.persistKind(field), field, value);
  }

  /**
   * How a column's values are written. A function of the column, not of the value, so a bulk insert
   * classifies each column once instead of re-deciding per row: a 20-row, 6-column insert asked
   * `isJsonType` and `isVectorFieldType` 120 times to get the same six answers.
   */
  protected persistKind(field: FieldOptions | undefined): PersistKind {
    const type = field?.type;
    if (isJsonType(type)) {
      return 'json';
    }
    return isVectorFieldType(type) ? 'vector' : 'plain';
  }

  /**
   * Which of an entity's columns need decoding on READ, and how: the inverse of {@link persistKind},
   * cached per entity for the same reason it classifies per column. A 1000-row read of a 10-field
   * entity otherwise asks `isJsonType` (which lowercases a string on every call) 10,000 times to get
   * the same ten answers. Most entities land here for their numeric columns alone, where the per-row
   * cost is one `typeof` against a value the driver usually decoded already.
   *
   * Dialect-aware exactly like {@link supportedVectorType}, because it has to be: a `sparsevec` field
   * is written as a plain dense vector everywhere but Postgres, so reading it back by the field's own
   * declared cast would look for a sparse literal that was never stored.
   *
   * A type lands here rather than at the driver when the wire type alone cannot decide it, and only
   * the declaration can: `Boolean` is 0/1 in a SQLite INTEGER and a MySQL `TINYINT(1)`, both
   * indistinguishable from a genuine small integer; a decimal is text from pg *and* mysql2, and only
   * the field says it was meant as a number; and `type: BigInt` shares BIGINT with `type: Number`, so
   * the wire decode has to be undone for it. All are no-ops where the driver already decoded.
   *
   * Classified through the same `isNumericType`/`isBooleanType`/`isJsonType` the rest of the library
   * uses, not against the constructors: `type` accepts a string logical type for every one of these
   * (`@Field({ type: 'decimal' })`), and matching `=== Number` alone left those reading back as text.
   */
  hydratableFields<E>(entity: Type<E>): readonly HydratableField[] {
    const cached = this.hydratable.get(entity as Type<object>);
    if (cached) {
      return cached;
    }
    const decoded: HydratableField[] = [];
    for (const [key, field] of Object.entries(getMeta(entity).fields)) {
      const kind = this.hydrateKind(field);
      if (kind) {
        decoded.push([key, kind]);
      }
    }
    this.hydratable.set(entity as Type<object>, decoded);
    return decoded;
  }

  /**
   * The same classification for an aggregate row. Not cached, because these columns are a shape of the
   * query rather than of the entity, and it is computed once per call either way.
   *
   * Mirrors `QueryAggregateFnResult`, which is the contract callers already compile against:
   * `$count`/`$sum`/`$avg` are a number whatever they aggregate, while `$min`/`$max` and every
   * `$group` column keep the aggregated field's own type, so they decode as that field would. Without
   * it a `$sum` over a BIGINT column came back as `'500'` from a result type that says `number`, since
   * Postgres widens that sum to NUMERIC and no driver can know it was meant as a JS number.
   */
  hydratableAggregates<E, G extends QueryGroupMap<E>, A extends QueryAggMap<E>>(
    entity: Type<E>,
    q: QueryAggregate<E, G, A>,
  ): readonly HydratableField[] {
    const { fields } = getMeta(entity);
    const decoded: HydratableField[] = [];
    for (const entry of parseGroupMap(q.$group, q.$agg)) {
      if (entry.kind === 'fn' && entry.op !== '$min' && entry.op !== '$max') {
        decoded.push([entry.alias, 'number']);
        continue;
      }
      // `$min`/`$max` read the field they aggregate; a `$group` column is that field. Only `$count`
      // takes `'*'`, and it went down the numeric path above, so there is always a field to look up.
      const key = entry.kind === 'fn' ? entry.fieldRef : entry.alias;
      const kind = this.hydrateKind(fields[key as FieldKey<E>]);
      if (kind) {
        decoded.push([entry.alias, kind]);
      }
    }
    return decoded;
  }

  /**
   * The mirror of {@link persistKind}: what one column decodes as, or nothing if it needs no decode.
   *
   * Ordered for correctness, not for speed - this runs once per entity, cached, never per row. The
   * one order that is load-bearing is `BigInt` before {@link isNumericType}, which answers true for
   * `BigInt` as well as `Number`: swap them and every `type: BigInt` property silently decodes to a
   * JS number again.
   */
  protected hydrateKind(field: FieldOptions | undefined): HydrateKind | undefined {
    const type = field?.type;
    if (isJsonType(type)) {
      return 'json';
    }
    if (isVectorFieldType(type)) {
      return this.supportedVectorType(resolveVectorCast(field));
    }
    if (isBooleanType(type)) {
      return 'boolean';
    }
    if (type === BigInt) {
      return 'bigint';
    }
    return isNumericType(type) ? 'number' : undefined;
  }

  private readonly hydratable = new WeakMap<Type<object>, readonly HydratableField[]>();

  /** The one type dispatch for a persisted value, over a column kind decided by the caller. */
  private writePersistableValue(
    ctx: QueryContext,
    kind: PersistKind,
    field: FieldOptions | undefined,
    value: unknown,
  ): void {
    if (value instanceof QueryRaw) {
      this.getRawValue(ctx, { value });
      return;
    }
    if (kind === 'json') {
      this.appendJsonValue(ctx, value, field?.type as JsonColumnType);
      return;
    }
    if (kind === 'vector' && Array.isArray(value)) {
      this.appendVectorValue(ctx, value, field);
      return;
    }
    ctx.addValue(value);
  }

  protected appendJsonValue(ctx: QueryContext, value: unknown, _type: JsonColumnType): void {
    ctx.addValue(value == null ? null : JSON.stringify(value));
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
      const asJson = isJsonbOp(op, value[op]);
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
  private escapedColumnOf(key: string, field: FieldOptions | undefined): string {
    if (!field) {
      return this.escapeId(this.resolveColumnName(key, field));
    }
    let escaped = this.escapedColumns.get(field);
    if (escaped === undefined) {
      escaped = this.escapeId(this.resolveColumnName(key, field));
      this.escapedColumns.set(field, escaped);
    }
    return escaped;
  }

  private escapedColumnName<E>(meta: EntityMeta<E>, key: string): string {
    return this.escapedColumnOf(key, meta.fields[key]);
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
    rel: RelationMeta,
    opts: QueryComparisonOptions,
    projection: '1' | 'COUNT(*)',
    val: QueryWhereMap<unknown>,
  ): void {
    const meta = getMeta(entity);
    const parentTable = this.resolveTableName(entity, meta);
    const references = rel.references;
    const escapedParentId = this.escapedParentColumn(parentTable, meta, opts, meta.id);
    const relatedEntity = rel.entity();
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
    val: QueryWhereMap<unknown>,
    rel: RelationMeta,
    opts: QueryComparisonOptions,
  ): void {
    ctx.append('EXISTS ');
    this.appendRelationSubquery(ctx, entity, rel, opts, '1', val);
  }

  /** Filter by relation size: the same subquery, counting instead of testing for existence. */
  protected compareRelationSize<E>(
    ctx: QueryContext,
    entity: Type<E>,
    sizeVal: number | QuerySizeComparisonOps,
    rel: RelationMeta,
    opts: QueryComparisonOptions,
  ): void {
    this.buildSizeComparison(ctx, () => this.appendRelationSubquery(ctx, entity, rel, opts, 'COUNT(*)', {}), sizeVal);
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

  /** The runtime half of {@link QuerySizeComparisonOps}: what a count can sensibly be compared with. */
  private static readonly SIZE_COMPARE_OPS: ReadonlySet<string> = new Set([
    '$eq',
    '$ne',
    '$gt',
    '$gte',
    '$lt',
    '$lte',
    '$between',
  ]);

  /**
   * Append a single size comparison operator and value. No operand: the count expression is already
   * in the context, so this contributes only the ` <op> <value>` tail.
   *
   * Gated on {@link SIZE_COMPARE_OPS} rather than on whatever the shared renderer accepts, because
   * that renderer also knows `$like`, `$regex` and `$in`, none of which mean anything against a
   * count. `$size: { $like: 5 }` has to stay the error it always was.
   */
  private appendSizeOp(ctx: QueryContext, op: string, val: unknown): void {
    if (!AbstractSqlDialect.SIZE_COMPARE_OPS.has(op)) {
      throw TypeError(`unsupported $size comparison operator: ${op}`);
    }
    // A COUNT is never NULL, so equality stays plain here instead of taking the shared renderer's
    // null-safe `$ne` (`IS DISTINCT FROM` on Postgres, `IS NOT` on SQLite). Same rows, shorter SQL.
    if (op === '$eq' || op === '$ne') {
      ctx.append(` ${op === '$eq' ? '=' : '<>'} ${this.addValue(ctx.values, val)}`);
      return;
    }
    this.appendOperatorCondition(ctx, '', op, val);
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
