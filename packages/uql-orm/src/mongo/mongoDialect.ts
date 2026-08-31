import { type Document, type Filter, ObjectId, type Sort, type UpdateFilter } from 'mongodb';
import { AbstractDialect } from '../dialect/abstractDialect.js';
import { type QueryJoin, type QueryJoins, resolveQueryJoins, resolveSortableJoin } from '../dialect/queryJoins.js';
import { getMeta } from '../entity/index.js';
import type { IndexType } from '../schema/types.js';
import type {
  DialectFeatures,
  EntityData,
  EntityMeta,
  FieldValue,
  JsonUpdateOp,
  Query,
  QueryAggMap,
  QueryAggregate,
  QueryAggregateOp,
  QueryExclude,
  QueryGroupMap,
  QueryLikeOp,
  QueryOptions,
  QueryPopulate,
  QuerySelect,
  QuerySelectValue,
  QuerySizeComparisonOps,
  QuerySortMap,
  QueryTextSearchOptions,
  QueryVectorSearch,
  QueryWhere,
  QueryWhereFieldOperatorMap,
  RelationKey,
  RelationMeta,
  Type,
} from '../type/index.js';
import { QueryRaw } from '../type/queryRaw.js';
import {
  asSelectMap,
  assertAggregateColumns,
  assertNonNegativeInteger,
  buildQueryWhereAsMap,
  type CallbackKey,
  fillOnFields,
  filterFieldKeys,
  getKeys,
  getRelationRequestSummary,
  hasKeys,
  isJsonUpdateOp,
  isOperatorMap,
  isOperatorObject,
  isVectorSearch,
  normalizeScalarFieldSelection,
  type ParsedGroupEntry,
  parseGroupMap,
  parseRelationSize,
  someKey,
} from '../util/index.js';

/**
 * Operators MongoDB already expresses natively. `Pick`'s constraint ties this back to
 * {@link QueryWhereFieldOperatorMap} so a rename there breaks this union at compile time.
 */
type MongoNativeOp = keyof Pick<
  QueryWhereFieldOperatorMap<unknown>,
  '$all' | '$size' | '$elemMatch' | '$eq' | '$ne' | '$lt' | '$lte' | '$gt' | '$gte' | '$in' | '$nin' | '$regex' | '$not'
>;

/** What a read pipeline contributes to {@link MongoDialect.readStages} beyond the query itself. */
type MongoReadStages = {
  /** Ordering, which runs after the lookups when it reads one of their fields. */
  readonly sort?: Sort;
  readonly pager?: MongoAggregationPipelineEntry<Document>[];
  /** Keys merged into the query's projection, when it has one: a vector search's score. */
  readonly project?: Record<string, 1>;
};

/** Accumulator threaded through `$where` rendering: the relation lookups it needs, and their temp fields. */
type RelationLookups = {
  readonly stages: MongoAggregationPipelineEntry<Document>[];
  readonly temps: string[];
};

/** Default {@link DialectFeatures} for MongoDB; shared by {@link MongoDialect} and its schema generator. */
export const mongoDialectFeatures: DialectFeatures = {
  explicitJsonCast: false,
  nativeArrays: false,
  supportsJsonb: false,
  ifNotExists: false,
  indexIfNotExists: false,
  schemas: false, // the connection picks the database, and a collection name takes no dot
  dropTableCascade: false,
  renameColumn: false,
  foreignKeyAlter: false,
  columnComment: false,
  inlineVectorIndex: false,
  vectorSupportsLength: false,
  supportsTimestamptz: false,
  defaultStringAsText: false,
};

export class MongoDialect extends AbstractDialect {
  protected override readonly featureDefaults = mongoDialectFeatures;

  readonly dialectName = 'mongodb';

  // The MongoDB driver reports the exact `_id` of every inserted document (`insertedIds`).
  override readonly insertIdSource = 'returning';

  private static readonly ID_KEY = '_id';
  /** Temporary lookup fields for relation conditions, dropped with `$unset` after the `$match`. */
  private static readonly REL_TEMP_PREFIX = '__uql_rel_';
  private static readonly REL_COUNT_KEY = 'n';
  private static readonly REL_NESTED_KEY = '__uql_target';
  private static readonly VECTOR_INDEX_TYPES = new Set<IndexType>(['vectorSearch', 'hnsw', 'ivfflat', 'vector']);

  /** Atlas rejects a `$vectorSearch` asking for more candidates than this. */
  private static readonly MAX_NUM_CANDIDATES = 10_000;

  // Direct field aggregates → MongoDB accumulator. `$count` is handled separately (COUNT(*) vs
  // COUNT(field) differ), so it is not listed here.
  private static readonly AGGREGATE_OP_MAP = new Map<QueryAggregateOp, string>([
    ['$sum', '$sum'],
    ['$avg', '$avg'],
    ['$min', '$min'],
    ['$max', '$max'],
  ]);

  /**
   * MongoDB stores the primary key as `_id`; everything else resolves as usual. Projections, sorts,
   * `$group` refs and `$where` keys all map through here, so no read path can address a property name
   * the document does not use.
   */
  override columnOf<E>(meta: EntityMeta<E>, key: string): string {
    if (key === MongoDialect.ID_KEY || key === meta.id) {
      return MongoDialect.ID_KEY;
    }
    return super.columnOf(meta, key);
  }

  public where<E extends Document>(entity: Type<E>, where: QueryWhere<E> = {}, opts: QueryOptions = {}): Filter<E> {
    const meta = getMeta(entity);
    // Filters are applied once, here at the scope entry point; recursion uses `renderFilter`.
    return this.renderFilter(entity, this.scopedWhereMap(meta, where, opts));
  }

  /**
   * A `$where` that may constrain relations, split into the `$lookup` stages it needs and the `$match`
   * filter that consumes them. Each relation condition becomes one correlated lookup into a temporary
   * field plus an ordinary condition on that field, so the caller's boolean structure survives intact
   * (a relation inside `$or` still means what it says) and nothing depends on materializing ids.
   * `unset` names the temporary fields, which the caller drops once the match is done.
   */
  public whereWithRelations<E extends Document>(
    entity: Type<E>,
    where: QueryWhere<E> = {},
    opts: QueryOptions = {},
  ): {
    // the stages read the *target* collections, so they are not shaped by `E`
    readonly stages: MongoAggregationPipelineEntry<Document>[];
    readonly filter: Filter<E>;
    readonly unset: string[];
  } {
    const meta = getMeta(entity);
    const lookups: RelationLookups = { stages: [], temps: [] };
    const filter = this.renderFilter(entity, this.scopedWhereMap(meta, where, opts), opts, lookups);
    return { stages: lookups.stages, filter, unset: lookups.temps };
  }

  /** Whether a `$where` constrains any relation, and so needs the aggregation path rather than a cursor. */
  public constrainsRelations<E extends Document>(entity: Type<E>, where: QueryWhere<E> | undefined): boolean {
    if (!where) {
      return false;
    }
    const meta = getMeta(entity);
    const whereMap = buildQueryWhereAsMap(meta, where) as Record<string, unknown>;
    return someKey(whereMap, (key) =>
      key === '$and' || key === '$or'
        ? (whereMap[key] as QueryWhere<E>[]).some((it) => this.constrainsRelations(entity, it))
        : Boolean(meta.relations[key as RelationKey<E>]),
    );
  }

  /**
   * Renders a `$where` tree without applying entity filters (used for same-scope `$and`/`$or`
   * recursion). Relation keys need `$lookup` stages, so they are only accepted when `lookups` is
   * given - a plain `find`/`updateMany` filter has nowhere to put them.
   */
  private renderFilter<E extends Document>(
    entity: Type<E>,
    where: QueryWhere<E> = {},
    opts?: QueryOptions,
    lookups?: RelationLookups,
  ): Filter<E> {
    const meta = getMeta(entity);
    const whereMap = buildQueryWhereAsMap(meta, where);

    const filter: Record<string, unknown> = {};
    for (const [rawKey, rawVal] of Object.entries(whereMap)) {
      let key = rawKey;
      let val: unknown = rawVal;
      if (key === '$and' || key === '$or') {
        filter[key] = (val as QueryWhere<E>[]).map((filterIt) => {
          // A `QueryRaw` here would recurse forever: `buildQueryWhereAsMap` re-wraps it as
          // `{ $and: [raw] }`, which lands back on this branch.
          this.assertNoRaw(filterIt);
          return this.renderFilter(entity, filterIt, opts, lookups);
        });
      } else if (key === '$text') {
        // MongoDB's text index declares which fields it covers, so `$fields` cannot narrow the search
        // the way it does elsewhere - the same shape as `$distance` being index-defined here.
        filter['$text'] = { $search: (val as QueryTextSearchOptions<E>).$value };
      } else if (meta.relations[key]) {
        this.assertNoRaw(val);
        if (!lookups) {
          throw new TypeError(`filtering by relation '${key}' is not supported here on MongoDB`);
        }
        Object.assign(filter, this.appendRelationLookup(meta, key, val, opts, lookups));
      } else {
        this.assertNoRaw(val);
        this.assertKnownPathRoot(meta, key);
        key = this.pathOf(meta, key);
        if (key === MongoDialect.ID_KEY) {
          val = this.getIdValue(val as IdValue);
        }
        if (isOperatorObject(val)) {
          val = this.transformOperators(val);
        } else if (Array.isArray(val)) {
          val = { $in: val };
        }
        filter[key] = val;
      }
    }
    return filter as Filter<E>;
  }

  /**
   * Emits the correlated `$lookup` for one relation condition and returns the condition that tests its
   * result: presence of a row for a plain relation filter, a comparison against the row count for
   * `$size`. The target's (and, for ManyToMany, the junction's) own filters scope the lookup, so a
   * relation subquery can no more read out-of-scope rows than a direct query on the target can.
   */
  private appendRelationLookup<E>(
    meta: EntityMeta<E>,
    relKey: string,
    val: unknown,
    opts: QueryOptions | undefined,
    lookups: RelationLookups,
  ): Record<string, unknown> {
    const relOpts = meta.relations[relKey]!;
    const relEntity = relOpts.entity();
    const relMeta = getMeta(relEntity);
    const temp = `${MongoDialect.REL_TEMP_PREFIX}${lookups.temps.length}`;
    const sizeVal = parseRelationSize(val);
    // `$count` for a size test, `$limit: 1` for existence: neither returns the matched documents.
    const tail = sizeVal === undefined ? [{ $limit: 1 }] : [{ $count: MongoDialect.REL_COUNT_KEY }];
    // Scope first, render once - merging the target's filters into an already-rendered filter would
    // leave their own keys unmapped. The caller's filter bypass is deliberately *not* passed down:
    // `withDeleted()` or `hardDelete` on the parent must not un-hide trashed rows of the target, the
    // same rule the SQL dialects' relation subqueries follow.
    const targetCondition = (sizeVal === undefined ? val : {}) as QueryWhere<Document>;
    const targetScope = this.renderFilter(relEntity, this.scopedWhereMap(relMeta, targetCondition), opts);

    lookups.temps.push(temp);
    lookups.stages.push(
      relOpts.cardinality === 'mm' && relOpts.through
        ? this.junctionLookup(relOpts, relMeta, relEntity, targetScope, temp, tail, opts)
        : {
            $lookup: {
              from: this.resolveTableName(relMeta),
              ...this.joinKeys(meta, relMeta, relOpts),
              pipeline: [...(hasKeys(targetScope) ? [{ $match: targetScope }] : []), ...tail],
              as: temp,
            },
          },
    );

    return sizeVal === undefined
      ? { [`${temp}.0`]: { $exists: true } }
      : { $expr: this.compareRelationCount(temp, sizeVal) };
  }

  /**
   * ManyToMany counts/tests junction rows, so the target is reached from inside the junction's own
   * lookup - the junction's filters apply too, since a soft-deleted link is not a link.
   */
  private junctionLookup(
    relOpts: RelationMeta,
    relMeta: EntityMeta<Document>,
    relEntity: Type<Document>,
    targetScope: Filter<Document>,
    temp: string,
    tail: Record<string, unknown>[],
    opts: QueryOptions | undefined,
  ): MongoAggregationPipelineEntry<Document> {
    const throughEntity = relOpts.through!();
    const throughMeta = getMeta(throughEntity);
    const junctionScope = this.renderFilter(throughEntity, this.scopedWhereMap(throughMeta, {}), opts);
    const nested = MongoDialect.REL_NESTED_KEY;

    return {
      $lookup: {
        from: this.resolveTableName(throughMeta),
        localField: MongoDialect.ID_KEY,
        foreignField: this.columnOf(throughMeta, relOpts.references[0].local),
        pipeline: [
          ...(hasKeys(junctionScope) ? [{ $match: junctionScope }] : []),
          {
            $lookup: {
              from: this.resolveTableName(relMeta),
              localField: this.columnOf(throughMeta, relOpts.references[1].local),
              foreignField: MongoDialect.ID_KEY,
              pipeline: [...(hasKeys(targetScope) ? [{ $match: targetScope }] : []), { $limit: 1 }],
              as: nested,
            },
          },
          { $match: { [`${nested}.0`]: { $exists: true } } },
          ...tail,
        ],
        as: temp,
      },
    } as MongoAggregationPipelineEntry<Document>;
  }

  /**
   * Compares the looked-up row count, which is `[{ n: <count> }]` or `[]` when nothing matched - hence
   * the `$ifNull` fallback to 0, so `{ $size: 0 }` matches parents with no related row at all.
   */
  private compareRelationCount(temp: string, sizeVal: number | QuerySizeComparisonOps): Record<string, unknown> {
    const count = { $ifNull: [{ $arrayElemAt: [`$${temp}.${MongoDialect.REL_COUNT_KEY}`, 0] }, 0] };
    if (typeof sizeVal === 'number') {
      return { $eq: [count, sizeVal] };
    }
    const comparisons: Record<string, unknown>[] = Object.entries(sizeVal)
      .filter(([, bound]) => bound !== undefined)
      .flatMap(([op, bound]): Record<string, unknown>[] =>
        op === '$between'
          ? [{ $gte: [count, (bound as [number, number])[0]] }, { $lte: [count, (bound as [number, number])[1]] }]
          : [{ [op]: [count, bound] }],
      );
    if (!comparisons.length) {
      throw new TypeError('$size on a relation needs at least one comparison');
    }
    return comparisons.length === 1 ? comparisons[0]! : { $and: comparisons };
  }

  /** Whether a query subtracts `key` from the projection, via `$exclude` or a negative `$select`. */
  private subtractsKey<E>(key: string, select?: QuerySelect<E>, exclude?: QueryExclude<E>): boolean {
    const at = (map: QuerySelect<E> | QueryExclude<E> | undefined) => (map as Record<string, unknown>)?.[key];
    return at(exclude) === true || at(select) === false;
  }

  /**
   * MongoDB has no row-level lock to map `$lock` onto: its concurrency control is the transaction
   * plus atomic document updates. Rejected rather than ignored, like `raw()` below, since a dropped
   * lock silently removes the mutual exclusion the caller asked for.
   */
  assertNoLock<E>(q: Query<E>): void {
    if (q.$lock !== undefined) {
      throw new TypeError('$lock (row-level locking) is not supported on MongoDB');
    }
  }

  /** `raw()` renders SQL, so it has no MongoDB equivalent - say so instead of emitting `{}`. */
  private assertNoRaw(value: unknown): void {
    if (value instanceof QueryRaw) {
      throw new TypeError('raw() in $where is not supported on MongoDB');
    }
  }

  /**
   * A dotted key addresses an embedded path, whose root must still be a declared field - otherwise it
   * is a typo (or an injected key) that would silently match nothing, the same guard the SQL dialects
   * apply to JSON paths.
   */
  private assertKnownPathRoot<E>(meta: EntityMeta<E>, key: string): void {
    const root = key.includes('.') ? key.slice(0, key.indexOf('.')) : key;
    if (root === MongoDialect.ID_KEY || root === meta.id || meta.fields[root as keyof typeof meta.fields & string]) {
      return;
    }
    throw new TypeError(`path ${key} does not exist in ${meta.name ?? ''}`);
  }

  protected mapTableNameRow(row: { table_name: string }): string {
    return row.table_name;
  }

  /** String operators → { pattern: (v) => regex, caseInsensitive } */
  private static readonly REGEX_OP_MAP = new Map<QueryLikeOp, { wrap: (v: unknown) => string; ci: boolean }>([
    ['$startsWith', { wrap: (v) => `^${v}`, ci: false }],
    ['$istartsWith', { wrap: (v) => `^${v}`, ci: true }],
    ['$endsWith', { wrap: (v) => `${v}$`, ci: false }],
    ['$iendsWith', { wrap: (v) => `${v}$`, ci: true }],
    ['$includes', { wrap: (v) => String(v), ci: false }],
    ['$iincludes', { wrap: (v) => String(v), ci: true }],
    ['$like', { wrap: (v) => String(v).replace(/%/g, '.*').replace(/_/g, '.'), ci: false }],
    ['$ilike', { wrap: (v) => String(v).replace(/%/g, '.*').replace(/_/g, '.'), ci: true }],
  ]);

  /** MongoDB native operators - pass through as-is. */
  private static readonly NATIVE_OPS = new Set<MongoNativeOp>([
    '$all',
    '$size',
    '$elemMatch',
    '$eq',
    '$ne',
    '$lt',
    '$lte',
    '$gt',
    '$gte',
    '$in',
    '$nin',
    '$regex',
    '$not',
  ]);

  /**
   * Transform UQL operators to MongoDB operators.
   */
  private transformOperators(ops: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [op, val] of Object.entries(ops)) {
      // `$elemMatch`'s value is itself a condition, so the operators inside it need the same
      // mapping - passing it through raw sends UQL-only operators (`$startsWith`, `$between`, ...)
      // straight to the server, which rejects them as unknown.
      if (op === '$elemMatch') {
        result[op] = this.transformElemMatch(val as Record<string, unknown>);
        continue;
      }
      // Native MongoDB operators - pass through directly
      if (MongoDialect.NATIVE_OPS.has(op as MongoNativeOp)) {
        result[op] = val;
        continue;
      }
      // String/pattern → regex operators (8 variants including $like/$ilike)
      const regexEntry = MongoDialect.REGEX_OP_MAP.get(op as QueryLikeOp);
      if (regexEntry) {
        result['$regex'] = regexEntry.wrap(val);
        if (regexEntry.ci) result['$options'] = 'i';
        continue;
      }
      // Structural transforms
      switch (op) {
        case '$between': {
          const [min, max] = val as [unknown, unknown];
          result['$gte'] = min;
          result['$lte'] = max;
          break;
        }
        case '$isNull':
          result[val ? '$eq' : '$ne'] = null;
          break;
        case '$isNotNull':
          result[val ? '$ne' : '$eq'] = null;
          break;
        case '$text':
          result['$text'] = { $search: val };
          break;
        default:
          result[op] = val;
          break;
      }
    }
    return result;
  }

  /**
   * Maps the conditions inside `$elemMatch`: an operator map applies to the element itself, anything
   * else is a per-field map whose operator objects each need mapping.
   */
  private transformElemMatch(match: Record<string, unknown>): Record<string, unknown> {
    if (isOperatorObject(match)) {
      return this.transformOperators(match);
    }
    return Object.fromEntries(
      Object.entries(match).map(([field, val]) => [field, isOperatorObject(val) ? this.transformOperators(val) : val]),
    );
  }

  public select<E extends Document>(
    entity: Type<E>,
    select?: QuerySelectValue<E>,
    exclude?: QueryExclude<E>,
  ): Record<string, 0 | 1> {
    const meta = getMeta(entity);
    if (!select && !exclude) {
      return {};
    }
    if (Array.isArray(select)) {
      throw new TypeError('raw $select is not supported on MongoDB');
    }
    const selectMap = asSelectMap(select);
    // Projected by column, not by field key; `normalizeId` maps them back on the way out.
    const projection = normalizeScalarFieldSelection(meta, selectMap, exclude).reduce<Record<string, 0 | 1>>(
      (acc, key) => {
        acc[this.columnOf(meta, key)] = 1;
        return acc;
      },
      {},
    );
    // MongoDB returns `_id` unless it is explicitly excluded, so subtracting the primary key needs
    // `_id: 0` - the one inclusion/exclusion mix MongoDB allows - or `$exclude: { id: true }` would
    // have no effect at all.
    if (this.subtractsKey(meta.id as string, selectMap, exclude)) {
      projection[MongoDialect.ID_KEY] = 0;
    }
    return projection;
  }

  /**
   * The `$sort` stage. A relation key reads the document a `$lookup` unwound onto the parent, so - as
   * on the SQL dialects - it is only addressable when the statement joins that relation. Here that
   * means a *populated* one, at every level of the path: a lookup adds a field to the result, so one
   * added for the sort alone would change what the caller gets back.
   */
  public sort<E extends Document>(entity: Type<E>, sort?: QuerySortMap<E>, populate?: QueryPopulate<E>): Sort {
    const meta = getMeta(entity);
    const normalized: Record<string, 1 | -1> = {};
    // The same join set the lookups are built from, so what an ordering may address and what the
    // pipeline actually produces cannot drift apart - `$sort` contributes its own to-one joins here
    // exactly as it does on the SQL dialects.
    this.collectSort(meta, sort, resolveQueryJoins(meta, { $populate: populate, $sort: sort }), '', normalized);
    return normalized as Sort;
  }

  /** Walks `$sort` against the metadata of the entity each level addresses, as the SQL dialects do. */
  private collectSort<E>(
    meta: EntityMeta<E>,
    sort: QuerySortMap<E> | undefined,
    joins: QueryJoins,
    path: string,
    out: Record<string, 1 | -1>,
  ): void {
    for (const [key, value] of Object.entries(sort ?? {})) {
      const relation = meta.relations[key as RelationKey<E>];
      if (!relation) {
        // The queried entity's own vector search is lifted out before this walk, so one reaching it
        // sits under a relation, which a `$lookup` brings in one row at a time - there is nothing to
        // rank. `sortDirection` would read the operator object as "ascending" and order by the raw
        // vector column instead, which is the SQL dialects' rejection turned into a silent answer.
        if (isVectorSearch(value)) {
          throw new TypeError(
            `$vector sort is only supported on the queried entity, not on relation '${path.slice(0, -1)}'`,
          );
        }
        out[path + this.pathOf(meta, key)] = sortDirection(value);
        continue;
      }
      // A `$lookup` is what puts the relation's fields on the document, and only `$populate` asks for
      // one: ordering by a relation nothing looked up reads a field that is not there, which MongoDB
      // ranks as all-equal rather than rejecting. The SQL dialects can add the join themselves.
      const relPath = `${path}${key}`;
      const { join, sort: relationSort } = resolveSortableJoin(
        relation,
        relPath,
        value,
        joins,
        `cannot $sort by relation '${relPath}' on MongoDB unless it is populated: only $populate adds its fields to the document`,
      );
      this.collectSort(join.meta, relationSort, joins, `${relPath}.`, out);
    }
  }

  /** Whether a `$sort` reads a relation, which is what forces the lookups to run before it. */
  public sortsRelations<E extends Document>(entity: Type<E>, sort: QuerySortMap<E> | undefined): boolean {
    if (!sort) {
      return false;
    }
    const meta = getMeta(entity);
    return someKey(sort, (key) => Boolean(meta.relations[key as RelationKey<E>]));
  }

  /**
   * Aggregate results are keyed by `$group`/`$agg` alias rather than by column, so an aggregate
   * `$sort` addresses those aliases as-is - the same reason the SQL dialects sort by alias there.
   */
  private aliasSort(sort: Record<string, unknown> | undefined): Sort {
    const normalized: Record<string, 1 | -1> = {};
    for (const [alias, dir] of Object.entries(sort ?? {})) {
      normalized[alias] = sortDirection(dir);
    }
    return normalized as Sort;
  }

  /**
   * {@link columnOf} for a possibly dotted key: only the root is a field key, the rest addresses an
   * embedded path (`kind.city` -> `<kind's column>.city`).
   */
  private pathOf<E>(meta: EntityMeta<E>, key: string): string {
    const dot = key.indexOf('.');
    if (dot < 0) {
      return this.columnOf(meta, key);
    }
    return this.columnOf(meta, key.slice(0, dot)) + key.slice(dot);
  }

  public aggregationPipeline<E extends Document>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
  ): MongoAggregationPipelineEntry<E>[] {
    // Lookups that a relation condition needs come first, then the match that reads them, then the
    // temporary fields are dropped so they never reach the caller.
    const { stages, filter, unset } = this.whereWithRelations(entity, q.$where, opts);
    return [
      ...stages,
      ...(hasKeys(filter) ? [{ $match: filter }] : []),
      ...(unset.length ? [{ $unset: unset }] : []),
      ...this.readStages(entity, q, opts, {
        sort: this.sort(entity, q.$sort, q.$populate),
        pager: [
          ...(q.$skip === undefined ? [] : [{ $skip: assertNonNegativeInteger(q.$skip, '$skip') }]),
          ...(q.$limit === undefined ? [] : [{ $limit: assertNonNegativeInteger(q.$limit, '$limit') }]),
        ],
      }),
    ];
  }

  /**
   * What a read runs after its entry stage, in the one order that works: the lookups its relations
   * need, the ordering and paging that may read them, and the projection last of all - it names the
   * fields the lookups add, and no stage after it could read what it dropped.
   *
   * Shared by the plain pipeline and the `$vectorSearch` one, which each used to spell the order out
   * for themselves and each got a different part of it wrong.
   */
  public readStages<E extends Document>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
    extra: MongoReadStages = {},
  ): MongoAggregationPipelineEntry<Document>[] {
    const meta = getMeta(entity);
    const joins = resolveQueryJoins(meta, q);
    const lookups = this.lookupStages(meta, joins, undefined, opts);
    const sort = hasKeys(extra.sort) ? [{ $sort: extra.sort }] : [];
    const pager = extra.pager ?? [];

    // Merged into the query's own projection rather than standing in for one: a query that asked
    // for no columns wants the whole document, not just the field this adds to it.
    const projection = this.pipelineProjection(entity, q);
    const projected = projection ? { ...projection, ...extra.project } : undefined;
    const project = projected ? [{ $project: projected }] : [];

    // A `$lookup` the ordering asked for puts a field on the document the caller never requested,
    // which is the one way this differs from a SQL join. Taken back out once the `$sort` that needed
    // it has run, so ordering by an unpopulated relation costs the same nothing it does there.
    const sortOnly = [...joins.values()].filter((join) => !join.projected).map((join) => join.path);
    const unset = sortOnly.length ? [{ $unset: sortOnly }] : [];

    // The grouping collapses rows onto the columns it projects, which leaves nothing for an ordering
    // that reads a lookup those columns do not carry. Refused rather than answered all-equal, and in
    // the same terms the SQL dialects refuse `SELECT DISTINCT` ordered by an unselected column.
    if (q.$distinct && sortOnly.length) {
      throw new TypeError(
        `cannot $sort by relation '${sortOnly[0]}' with $distinct unless '${sortOnly[0]}' is populated: the grouping keeps only the columns it projects`,
      );
    }

    // `$distinct` inverts the usual order twice over: the projection decides which columns make two
    // rows the same, so it has to run *before* the grouping, and the grouping collapses rows, so the
    // ordering and the page have to run after it to address the set the caller actually receives.
    const dedup = q.$distinct ? this.distinctStages(projected) : [];
    if (dedup.length) {
      return [...lookups, ...project, ...dedup, ...sort, ...pager];
    }

    // A `$required` relation drops parents when it unwinds, and an ordering may read a field only a
    // lookup produces: either one puts the lookups first, as an INNER JOIN does. Otherwise paging
    // first is equivalent and spares the lookups the rows it cuts.
    const lookupsFirst =
      this.sortsRelations(entity, q.$sort) ||
      lookups.some((stage) => stage.$unwind?.preserveNullAndEmptyArrays === false);
    return [
      ...(lookupsFirst ? [...lookups, ...sort, ...pager] : [...sort, ...pager, ...lookups]),
      ...unset,
      ...project,
    ];
  }

  /**
   * `$distinct` as a `$group` on the columns the query projects - the same set a SQL dialect puts
   * after `SELECT DISTINCT` - and the `$replaceRoot` that lifts the grouped key back to the top
   * level. A query that projects nothing selects every column, primary key included, so there is
   * nothing to collapse: `SELECT DISTINCT *` collapses nothing either.
   */
  private distinctStages(projection?: Record<string, 0 | 1>): MongoAggregationPipelineEntry<Document>[] {
    if (!projection) {
      return [];
    }
    const keys = getKeys(projection).filter((key) => projection[key] === 1);
    if (!keys.length) {
      return [];
    }
    const groupId = Object.fromEntries(keys.map((key) => [key, `$${key}`]));
    return [{ $group: { _id: groupId } }, { $replaceRoot: { newRoot: '$_id' } }];
  }

  /**
   * The scalar projection a narrowing query asks for, widened by what the pipeline itself produced:
   * the joined documents, and the `_id` a to-many fill groups children by. It goes last, after the
   * lookups have read the join keys - projecting any earlier is what used to leave `$populate`
   * empty, and is why the pipeline emitted no projection at all and returned every column.
   */
  public pipelineProjection<E extends Document>(entity: Type<E>, q: Query<E>): Record<string, 0 | 1> | undefined {
    if (!q.$select && !q.$exclude) {
      return undefined;
    }
    const projection = this.select(entity, q.$select, q.$exclude);
    const summary = getRelationRequestSummary(getMeta(entity), q.$populate);
    for (const relKey of summary.joinableKeys) {
      projection[relKey] = 1;
    }
    // Only ever undoes an exclusion: a relation cannot be filled onto a parent with no key.
    if (summary.requestedKeys.length && projection[MongoDialect.ID_KEY] === 0) {
      delete projection[MongoDialect.ID_KEY];
    }
    return projection;
  }

  /**
   * `$lookup`/`$unwind` stages for the joinable relations a query populates. Shared by the plain
   * aggregation pipeline and the `$vectorSearch` one, so relations load the same way in both.
   */
  public relationStages<E extends Document>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
  ): MongoAggregationPipelineEntry<E>[] {
    // The whole query, not `$populate` alone: an ordering by a related field needs that relation
    // looked up just as much as selecting it does. A `$lookup` does put a field on the document
    // where a SQL join is invisible, so the ones only the ordering asked for are unset again by
    // {@link readStages} before the caller sees the row.
    const meta = getMeta(entity);
    return this.lookupStages(meta, resolveQueryJoins(meta, q), undefined, opts);
  }

  /**
   * The `$lookup`/`$unwind` pair for each relation joined below `parent`, its own relations nested
   * inside its pipeline and resolved before the projection that reads them.
   */
  private lookupStages<P>(
    parentMeta: EntityMeta<P>,
    joins: QueryJoins,
    parent: QueryJoin | undefined,
    opts?: QueryOptions,
  ): MongoAggregationPipelineEntry<Document>[] {
    const pipeline: MongoAggregationPipelineEntry<Document>[] = [];

    // Every join at this level hangs off `parent`, so its metadata is `parentMeta` - no branch, and
    // no union of two unrelated entity types to resolve the join column through.
    for (const join of joins.values()) {
      if (join.parent !== parent) {
        continue;
      }
      // Unconditional, not gated by an explicit relation-level `$where`: the related entity's own
      // filters (in particular `security: true` ones) must apply even to a bare
      // `$populate: { rel: true }`, exactly like the SQL dialects' JOIN ON-clause filters.
      const relationFilter = this.where(join.entity, join.query.$where ?? {}, opts);
      // The relation's own projection runs inside the lookup, where its keys resolve against the
      // related entity. Left out, `$populate: { rel: { $select } }` returned all of `rel`'s columns.
      const relationProjection = this.pipelineProjection(join.entity, join.query);
      // MongoDB returns `_id` unless a projection subtracts it, so dropping the key from the map is
      // how a joined document keeps its own id - as it does on the SQL dialects, and as a nested
      // to-many fill needs.
      delete relationProjection?.[MongoDialect.ID_KEY];

      const lookupPipeline = [
        ...(hasKeys(relationFilter) ? [{ $match: relationFilter }] : []),
        ...this.lookupStages(join.meta, joins, join, opts),
        ...(relationProjection ? [{ $project: relationProjection }] : []),
      ];

      pipeline.push({
        $lookup: {
          from: this.resolveTableName(join.meta),
          ...this.joinKeys(parentMeta, join.meta, join.relation),
          ...(lookupPipeline.length ? { pipeline: lookupPipeline } : {}),
          as: join.key,
        },
      });

      // `$required` drops parents with no match, the aggregation equivalent of an INNER JOIN.
      pipeline.push({ $unwind: { path: `$${join.key}`, preserveNullAndEmptyArrays: !join.required } });
    }

    return pipeline;
  }

  /**
   * The correlated join for a single-valued or one-to-many relation. MongoDB runs a lookup's `pipeline`
   * after its own localField/foreignField match, so the target's filters layer on top of the join
   * condition with no `let`/`$expr` rewrite: m1 joins the parent's FK to the target's `_id`, every other
   * direction joins the parent's `_id` to the target's FK.
   */
  private joinKeys<E, R extends Document>(
    meta: EntityMeta<E>,
    relMeta: EntityMeta<R>,
    relOpts: RelationMeta,
  ): { localField: string; foreignField: string } {
    return relOpts.cardinality === 'm1'
      ? { localField: this.columnOf(meta, relOpts.references[0].local), foreignField: MongoDialect.ID_KEY }
      : { localField: MongoDialect.ID_KEY, foreignField: this.columnOf(relMeta, relOpts.references[0].foreign) };
  }

  /** `[column, key]` for the fields whose stored name differs from their property name, memoized per entity. */
  private renamedColumns<E>(meta: EntityMeta<E>): readonly [string, string][] {
    let renamed = this.#renamedColumns.get(meta);
    if (!renamed) {
      renamed = getKeys(meta.fields)
        .map((key): [string, string] => [this.columnOf(meta, key), key])
        .filter(([column, key]) => column !== key);
      this.#renamedColumns.set(meta, renamed);
    }
    return renamed;
  }

  // Keyed by the meta object itself; entity metadata is immutable once defined.
  readonly #renamedColumns = new WeakMap<object, readonly [string, string][]>();

  public normalizeIds<E extends Document>(meta: EntityMeta<E>, docs: E[] | undefined): E[] | undefined {
    return docs?.map((doc) => this.normalizeId(meta, doc)) as E[] | undefined;
  }

  public normalizeId<E extends Document>(meta: EntityMeta<E>, doc: E | undefined): E | undefined {
    if (!doc) {
      return doc;
    }

    const res = doc as Record<string, unknown>;
    const _id = MongoDialect.ID_KEY;

    if (res[_id]) {
      res[meta.id as string] = res[_id];
      if (meta.id !== _id) {
        delete res[_id];
      }
    }

    // Only the renamed fields need touching, and which those are is a property of the entity, not of
    // the document - so it is derived once instead of for every row of a result set.
    for (const [column, key] of this.renamedColumns(meta)) {
      if (res[column] !== undefined) {
        res[key] = res[column];
        delete res[column];
      }
    }

    const relKeys = getKeys(meta.relations).filter((key) => res[key]) as RelationKey<E>[];

    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];
      if (!relOpts) continue;
      const relMeta = getMeta(relOpts.entity());
      res[relKey] = Array.isArray(res[relKey])
        ? this.normalizeIds(relMeta, res[relKey] as Document[])
        : this.normalizeId(relMeta, res[relKey] as Document);
    }

    return res as E;
  }

  public getIdValue<T extends IdValue>(value: T): T {
    if (value instanceof ObjectId) {
      return value;
    }
    try {
      return new ObjectId(value) as T;
    } catch (e) {
      return value;
    }
  }

  public getPersistable<E extends Document>(
    meta: EntityMeta<E>,
    payload: EntityData<E>,
    callbackKey: CallbackKey,
  ): Partial<E> {
    return this.getPersistables(meta, payload, callbackKey)[0];
  }

  /** One MongoDB update document's operators, grouped by kind and keyed by dotted path. */
  private groupUpdateOperators<E extends Document>(
    persistable: Partial<E>,
  ): { set: Document; push: Document; pull: Document; unset: Set<string> } {
    const set: Document = {};
    const push: Document = {};
    const pull: Document = {};
    const unset = new Set<string>();
    for (const [key, value] of Object.entries(persistable)) {
      if (!isJsonUpdateOp(value)) {
        set[key] = value;
        continue;
      }
      for (const [path, v] of Object.entries(value.$set ?? {})) {
        set[`${key}.${path}`] = v;
      }
      for (const path of value.$unset ?? []) {
        unset.add(`${key}.${path}`);
      }
      for (const [path, v] of Object.entries(value.$push ?? {})) {
        push[`${key}.${path}`] = v;
      }
      for (const [path, v] of Object.entries(value.$pull ?? {})) {
        pull[`${key}.${path}`] = v;
      }
    }
    return { set, push, pull, unset };
  }

  /**
   * Turn a persistable payload into a MongoDB update, mapping UQL's JSON operators onto their native
   * equivalents: `$set` becomes dotted-path assignments, `$unset`/`$push`/`$pull` map one-to-one.
   * Plain field values are assigned with `$set`.
   */
  public getUpdateFilter<E extends Document>(persistable: Partial<E>): UpdateFilter<E> | Document[] {
    const groups = this.groupUpdateOperators(persistable);
    const { set, push, pull, unset } = groups;
    const exprKeys = [...Object.keys(pull), ...Object.keys(set), ...Object.keys(push)];

    // MongoDB rejects two operators targeting one path in a single update document, so any path
    // reached by more than one operator group forces the pipeline form.
    const allPaths = [...exprKeys, ...unset];
    if (new Set(allPaths).size < allPaths.length) {
      return this.getUpdatePipeline(groups, new Set(exprKeys));
    }
    return {
      ...(hasKeys(set) && { $set: set }),
      ...(hasKeys(push) && { $push: push }),
      ...(hasKeys(pull) && { $pull: pull }),
      ...(unset.size > 0 && { $unset: Object.fromEntries([...unset].map((path) => [path, ''])) }),
    } as UpdateFilter<E>;
  }

  /**
   * MongoDB rejects two operators targeting one path in a single update document, so any path shared
   * across operator groups is expressed as one aggregation-pipeline update instead.
   *
   * Each path's expression is composed in the same order stated on {@link JsonUpdateOp} (`$pull` ->
   * `$set` -> `$push` -> `$unset`), so every combination yields the identical result: a `$pull`
   * filters the stored array, a `$set` on the same path then replaces it outright, and a `$push`
   * appends to whatever those produced. `$unset` is a later stage, so it wins over a `$set` on the
   * same path - again matching SQL, where it is the outermost wrapper. Values are wrapped in
   * `$literal` so a string starting with `$` stays data rather than becoming a field reference.
   */
  private getUpdatePipeline(
    { set, push, pull, unset }: { set: Document; push: Document; pull: Document; unset: ReadonlySet<string> },
    exprPaths: ReadonlySet<string>,
  ): Document[] {
    const assignments: Document = {};
    for (const path of exprPaths) {
      let expr: Document = { $ifNull: [`$${path}`, []] };
      if (path in pull) {
        expr = { $filter: { input: expr, cond: { $ne: ['$$this', { $literal: pull[path] }] } } };
      }
      if (path in set) {
        expr = { $literal: set[path] };
      }
      if (path in push) {
        expr = { $concatArrays: [expr, [{ $literal: push[path] }]] };
      }
      // Only `$set` and `$push` create a key. A `$pull` alone has to leave an absent one absent, and
      // `$$REMOVE` is how a pipeline `$set` skips a field - without it the filter would store `[]`.
      assignments[path] = path in set || path in push ? expr : { $cond: [{ $isArray: `$${path}` }, expr, '$$REMOVE'] };
    }
    return [{ $set: assignments }, ...(unset.size > 0 ? [{ $unset: [...unset] }] : [])];
  }

  public getPersistables<E extends Document>(
    meta: EntityMeta<E>,
    payload: EntityData<E> | EntityData<E>[],
    callbackKey: CallbackKey,
  ): Partial<E>[] {
    const payloads = fillOnFields(meta, payload, callbackKey);
    // Keys are resolved per document so heterogeneous payloads keep every provided field.
    return payloads.map((it) =>
      filterFieldKeys(meta, it, callbackKey).reduce<Partial<E>>(
        (acc, key) => {
          const field = meta.fields[key];
          (acc as Record<string, unknown>)[this.resolveColumnName(key, field!)] = it[key];
          return acc;
        },
        {} as Partial<E>,
      ),
    );
  }

  /**
   * Build MongoDB aggregation pipeline stages from a QueryAggregate.
   */
  public buildAggregateStages<E extends Document, const G extends QueryGroupMap<E>, const A extends QueryAggMap<E>>(
    entity: Type<E>,
    q: QueryAggregate<E, G, A>,
    opts?: QueryOptions,
  ): Record<string, unknown>[] {
    const pipeline: Record<string, unknown>[] = [];

    // $match stage (WHERE equivalent - before grouping)
    if (q.$where) {
      const filter = this.where(entity, q.$where, opts);
      if (hasKeys(filter)) {
        pipeline.push({ $match: filter });
      }
    }

    // $group stage
    const { groupId, groupAccumulators, distinctReducers } = this.buildGroupSpec(
      getMeta(entity),
      parseGroupMap(q.$group, q.$agg),
    );

    pipeline.push({ $group: { _id: hasKeys(groupId) ? groupId : null, ...groupAccumulators } });

    // Project stage - rename _id fields back to their original names, and reduce collected distinct
    // sets. Needed whenever there are group keys OR any distinct alias.
    if (hasKeys(groupId) || distinctReducers.size) {
      const project: Record<string, unknown> = { _id: 0 };
      for (const alias of Object.keys(groupId)) {
        project[alias] = `$_id.${alias}`;
      }
      for (const alias of Object.keys(groupAccumulators)) {
        const reduceOp = distinctReducers.get(alias);
        project[alias] = reduceOp ? { [reduceOp]: `$${alias}` } : 1;
      }
      pipeline.push({ $project: project });
    }

    // Everything the pipeline emits, which is all `$having` and `$sort` may name. The `$project`
    // above has already dropped the rest, so an unchecked key matched nothing or ordered by nothing.
    const emitted = new Set([...Object.keys(groupId), ...Object.keys(groupAccumulators)]);

    // $match stage for HAVING (post-group filtering)
    if (q.$having) {
      assertAggregateColumns(q.$having, emitted, '$having');
      const havingFilter = this.buildHavingFilter(q.$having);
      if (hasKeys(havingFilter)) {
        pipeline.push({ $match: havingFilter });
      }
    }

    // $sort stage - by alias, since $group/$project already renamed everything
    if (q.$sort) {
      assertAggregateColumns(q.$sort, emitted, '$sort');
      const sort = this.aliasSort(q.$sort);
      if (hasKeys(sort)) {
        pipeline.push({ $sort: sort });
      }
    }

    // $skip and $limit stages
    if (q.$skip !== undefined) {
      pipeline.push({ $skip: assertNonNegativeInteger(q.$skip, '$skip') });
    }
    if (q.$limit !== undefined) {
      pipeline.push({ $limit: assertNonNegativeInteger(q.$limit, '$limit') });
    }

    return pipeline;
  }

  /**
   * Resolve parsed group entries into the `_id` keys and accumulators of a `$group` stage.
   * `distinctReducers` maps each DISTINCT alias (collected via `$addToSet`) to the `$project`
   * operator that reduces its set: `$size` for `$count`, `$sum`/`$avg` for the numeric ops.
   */
  private buildGroupSpec<E>(
    meta: EntityMeta<E>,
    groupEntries: ParsedGroupEntry[],
  ): {
    groupId: Record<string, string>;
    groupAccumulators: Record<string, Record<string, unknown>>;
    distinctReducers: Map<string, string>;
  } {
    if (!groupEntries.length) {
      throw new TypeError('aggregate requires at least one $group column or $agg function');
    }
    const groupId: Record<string, string> = {};
    const groupAccumulators: Record<string, Record<string, unknown>> = {};
    const distinctReducers = new Map<string, string>();

    for (const entry of groupEntries) {
      // Aliases stay as the caller wrote them ($project maps them back); the *refs* address columns.
      const ref =
        entry.kind === 'key' ? `$${this.columnOf(meta, entry.alias)}` : `$${this.columnOf(meta, entry.fieldRef)}`;
      if (entry.kind === 'key') {
        groupId[entry.alias] = ref;
      } else if (entry.distinct) {
        // Collect the set now; reduce it in $project: `$size` counts it, `$sum`/`$avg` reduce the array.
        groupAccumulators[entry.alias] = { $addToSet: ref };
        distinctReducers.set(entry.alias, entry.op === '$count' ? '$size' : entry.op);
      } else if (entry.op === '$count') {
        // COUNT(*) counts every row; COUNT(field) counts non-null values, matching SQL.
        groupAccumulators[entry.alias] =
          entry.fieldRef === '*' ? { $sum: 1 } : { $sum: { $cond: [{ $ne: [ref, null] }, 1, 0] } };
      } else {
        const mongoOp = MongoDialect.AGGREGATE_OP_MAP.get(entry.op);
        if (!mongoOp) {
          throw TypeError(`unsupported aggregate operator: ${entry.op}`);
        }
        groupAccumulators[entry.alias] = { [mongoOp]: ref };
      }
    }

    return { groupId, groupAccumulators, distinctReducers };
  }

  private buildHavingFilter(having: Record<string, unknown>): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    for (const [alias, condition] of Object.entries(having)) {
      if (condition === undefined) continue;
      // Classified exactly as the SQL side classifies a `$where`/`$having` value, so the two agree
      // on identical input. Keeping only numbers and objects dropped a string or boolean without a
      // word, handing back every group instead of the filtered ones.
      if (isOperatorMap(condition)) {
        filter[alias] = this.transformOperators(condition);
      } else {
        filter[alias] = Array.isArray(condition) ? { $in: condition } : condition;
      }
    }
    return filter;
  }

  /**
   * Separate vector sort entries from regular sort entries.
   * Returns `undefined` if no vector sort is present.
   */
  extractVectorSort<E extends Document>(sort: QuerySortMap<E> | undefined): ExtractedVectorSort<E> | undefined {
    if (!sort) return undefined;
    let vectorKey: string | undefined;
    let vectorSearch: QueryVectorSearch | undefined;
    const regularSort = {} as QuerySortMap<E>;

    for (const [key, value] of Object.entries(sort)) {
      if (isVectorSearch(value)) {
        vectorKey = key;
        vectorSearch = value;
      } else {
        (regularSort as Record<string, unknown>)[key] = value;
      }
    }

    if (!vectorKey || !vectorSearch) return undefined;

    return { vectorKey, vectorSearch, regularSort };
  }

  /**
   * Build a `$vectorSearch` aggregation pipeline stage.
   * Merges `$where` into `$vectorSearch.filter` for optimal pre-filtering.
   */
  buildVectorSearchStage<E extends Document>(
    entity: Type<E>,
    key: string,
    search: QueryVectorSearch,
    where: QueryWhere<E> | undefined,
    limit: number,
    opts?: QueryOptions,
  ): Record<string, unknown> {
    const meta = getMeta(entity);
    const field = meta.fields[key];
    if (!field) {
      throw new TypeError(`Field '${key}' not found in entity '${meta.name}'`);
    }
    const colName = this.resolveColumnName(key, field);

    // Resolve index name from @Index metadata, or fall back to convention
    const indexMeta = meta.indexes?.find(
      (idx) => idx.columns.some((entry) => entry.column === key) && MongoDialect.VECTOR_INDEX_TYPES.has(idx.type!),
    );
    const indexName = indexMeta?.name ?? `${colName}_index`;

    if (!limit) {
      throw new TypeError(`$vectorSearch requires $limit (vector sort on '${key}' of '${meta.name}')`);
    }

    const stage: Record<string, unknown> = {
      index: indexName,
      path: colName,
      queryVector: [...search.$vector],
      // Atlas caps `numCandidates` at 10000 and wants roughly 10x the limit below that.
      numCandidates: Math.min(limit * 10, MongoDialect.MAX_NUM_CANDIDATES),
      limit,
    };

    // Pre-filter: merge $where into $vectorSearch.filter
    if (where) {
      const filter = this.where(entity, where, opts);
      if (hasKeys(filter)) {
        stage['filter'] = filter;
      }
    }

    return { $vectorSearch: stage };
  }
}

export type MongoAggregationPipelineEntry<E extends Document> = {
  $lookup?: MongoAggregationLookup<E>;
  $match?: Filter<E> | Record<string, unknown>;
  $sort?: Sort;
  $unwind?: MongoAggregationUnwind;
  $group?: Record<string, unknown>;
  $project?: Record<string, unknown>;
  $replaceRoot?: { readonly newRoot: string | Record<string, unknown> };
  $addFields?: Record<string, unknown>;
  $vectorSearch?: Record<string, unknown>;
  $count?: string;
  $unset?: string | string[];
  $skip?: number;
  $limit?: number;
};

type MongoAggregationLookup<E extends Document> = {
  readonly from?: string;
  readonly foreignField?: string;
  readonly localField?: string;
  readonly pipeline?: MongoAggregationPipelineEntry<FieldValue<E>>[];
  /** A relation key when populating, a temporary field when a relation condition is being tested. */
  readonly as?: string;
};

type MongoAggregationUnwind = {
  readonly path?: string;
  readonly preserveNullAndEmptyArrays?: boolean;
};

type IdValue = string | ObjectId;

export type ExtractedVectorSort<E> = {
  readonly vectorKey: string;
  readonly vectorSearch: QueryVectorSearch;
  readonly regularSort: QuerySortMap<E>;
};

/** `-1` for the two descending spellings, `1` for everything else - MongoDB knows no other value. */
function sortDirection(value: unknown): 1 | -1 {
  return value === 'desc' || value === -1 ? -1 : 1;
}
