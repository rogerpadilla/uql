import { type Document, type Filter, ObjectId, type Sort, type UpdateFilter } from 'mongodb';
import { AbstractDialect } from '../dialect/abstractDialect.js';
import {
  AGGREGATE_VALUE_ALIAS,
  REL_NESTED_KEY,
  REL_TEMP_PREFIX,
  SUM_COUNT_ALIAS,
  sortCountField,
  TEXT_SCORE_ALIAS,
} from '../dialect/aliases.js';
import {
  aggregateColumnField,
  groupPathField,
  type QueryJoin,
  type QueryJoins,
  resolveGroupJoins,
  resolveQueryJoins,
  resolveSortableJoin,
} from '../dialect/queryJoins.js';
import { assertSoleId, fieldOf, getMeta, relationOf, soleIdOf } from '../entity/index.js';
import type {
  RelationAggregateOp,
  RelationAggregateSpec,
  DialectFeatures,
  EntityData,
  EntityMeta,
  FieldKey,
  FieldOptions,
  FieldUpdateOp,
  Query,
  QueryAggMap,
  QueryAggregate,
  QueryExclude,
  QueryGroupMap,
  QueryGroupOp,
  QueryLikeOp,
  QueryOptions,
  QueryPager,
  QuerySelect,
  QuerySelectValue,
  QuerySortMap,
  QueryTextSearchOptions,
  QueryVectorSearch,
  QueryWhere,
  QueryWhereArray,
  QueryWhereFieldOperatorMap,
  RelationKey,
  RelationMeta,
  RelationQuery,
  Type,
} from '../type/index.js';
import { COUNT_RESULT_KEY } from '../type/query.js';
import { QueryRaw } from '../type/queryRaw.js';
import {
  aggregateOf,
  asSelectMap,
  assertAggregateColumns,
  assertNonNegativeInteger,
  type CallbackKey,
  columnFamily,
  countedRelations,
  entityName,
  fieldUpdateOf,
  fillOnFields,
  filterFieldKeys,
  findVectorIndex,
  findVectorSort,
  getKeys,
  getRelationRequestSummary,
  hasKeys,
  isFieldUpdateOp,
  isJsonObject,
  isJsonUpdateOp,
  isOperatorMap,
  isOperatorObject,
  isRecord,
  isVectorSearch,
  normalizeScalarFieldSelection,
  type ParsedGroupEntry,
  parentJoins,
  parseGroupMap,
  parseRelationAtKey,
  parseRelationSize,
  parseSortByCount,
  rankedTextSearch,
  someKey,
  targetKeyColumns,
  textSortOf,
} from '../util/index.js';
import { decodeBigIntsExcept } from '../util/wideNumber.js';

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
  /** A score the read answers as a field, a vector search's or a text search's; a temporary one leaves again. */
  readonly score?: {
    readonly field: string;
    readonly meta: 'vectorSearchScore' | 'textScore';
    readonly temporary?: boolean;
  };
};

/** Accumulator threaded through `$where` rendering: the relation lookups it needs, and their temp fields. */
type RelationLookups = {
  readonly stages: MongoAggregationPipelineEntry<Document>[];
  readonly temps: string[];
};

/** A scalar field's operator as the aggregation operator computing it. */
const MONGO_ARITHMETIC = { $inc: '$add', $mul: '$multiply' } as const satisfies Record<keyof FieldUpdateOp, string>;

/** An update's operators, grouped by kind and keyed by dotted path. */
type UpdateGroups = {
  readonly set: Document;
  readonly push: Document;
  readonly pull: Document;
  /** Each scalar field's operator as the pipeline expression computing it, a `null` or missing value read as 0. */
  readonly arithmetic: Document;
  readonly unset: ReadonlySet<string>;
};

/**
 * A text-search config as MongoDB names the language: the same word for each language both know, and
 * `'none'` for the no-stemming parser Postgres calls `'simple'`. {@link textConfigOf} reads one back.
 */
export function textLanguage(config: string): string {
  return config === 'simple' ? 'none' : config;
}

/** A MongoDB language as the text-search config it is, the inverse of {@link textLanguage}. */
export function textConfigOf(language: string): string {
  return language === 'none' ? 'simple' : language;
}

/** Default {@link DialectFeatures} for MongoDB. */
export const mongoDialectFeatures: DialectFeatures = {
  ifNotExists: false,
  indexIfNotExists: false,
  schemas: false, // the connection picks the database, and a collection name takes no dot
  dropTableCascade: false,
  foreignKeyAlter: false,
  primaryKeyAlter: false,
  generatedColumnAdd: false,
  commentSyntax: 'none',
  vectorIndexRequiresNotNull: false,
  vectorSupportsLength: false,
  vectorBytes: false,
  supportsTimestamptz: false,
  stringSizing: 'bounded-text',
  supportsUnsigned: false,
  serverSideCursors: false,
  correlatedWrites: false,
};

/** What `toWireId` converts: the hex spelling of an `ObjectId`, and nothing looser. */
const HEX_24 = /^[0-9a-f]{24}$/i;

/** How a declared column type reads in a message: `Number`, `uuid` - not its whole source. */
function declaredTypeName(type: unknown): string {
  return typeof type === 'function' ? type.name : String(type);
}

export class MongoDialect extends AbstractDialect {
  override readonly features: DialectFeatures = mongoDialectFeatures;

  readonly dialectName = 'mongodb';

  // The MongoDB driver reports the exact `_id` of every inserted document (`insertedIds`).
  override readonly insertIdSource = 'returning';

  private static readonly ID_KEY = '_id';
  /** Atlas rejects a `$vectorSearch` asking for more candidates than this. */
  private static readonly MAX_NUM_CANDIDATES = 10_000;

  /**
   * MongoDB stores the primary key as `_id`; everything else resolves as usual. Projections, sorts,
   * `$group` refs and `$where` keys all map through here, so no read path can address a property name
   * the document does not use.
   */
  override columnOf<E>(meta: EntityMeta<E>, key: string): string {
    if (key === MongoDialect.ID_KEY) {
      return MongoDialect.ID_KEY;
    }
    if (meta.fields[key]?.isId) {
      // A document has one `_id`. A composite key is a different document shape - a sub-document,
      // whose field order decides equality - rather than a translation, so it is refused here, which
      // every read reaches, and in `getPersistables`, which every write reaches.
      assertSoleId(meta, 'MongoDB');
      return MongoDialect.ID_KEY;
    }
    return super.columnOf(meta, key);
  }

  public where<E extends Document>(entity: Type<E>, where: QueryWhere<E> = {}, opts: QueryOptions = {}): Filter<E> {
    const meta = getMeta(entity);
    // Filters are applied once, here at the scope entry point; recursion uses `renderFilter`.
    return this.renderFilter(entity, this.scopedWhere(meta, where, opts));
  }

  /**
   * The stages every pipeline starts with: the `$lookup` each relation condition needs, into a temporary
   * field so `$or` keeps its meaning, the `$match` reading them, and the temporaries taken back out. Each
   * relation aggregate the `$where` or `named` reads is left on the document, once, under its column.
   */
  public matchStages<E extends Document>(
    entity: Type<E>,
    where: QueryWhere<E> = {},
    opts: QueryOptions = {},
    named: readonly string[] = [],
  ): MongoAggregationPipelineEntry<Document>[] {
    const meta = getMeta(entity);
    const lookups: RelationLookups = { stages: [], temps: [] };
    for (const key of named) {
      this.appendAggregateField(meta, key, lookups);
    }
    const filter = this.renderFilter(entity, this.scopedWhere(meta, where, opts), lookups);
    return [
      ...lookups.stages,
      ...(hasKeys(filter) ? [{ $match: filter }] : []),
      ...(lookups.temps.length ? [{ $unset: lookups.temps }] : []),
    ];
  }

  /**
   * Renders a `$where` tree without applying entity filters (used for same-scope group-operator
   * recursion). A relation, or a relation aggregate, needs `$lookup` stages, so it is only accepted
   * when `lookups` is given - a plain `find`/`updateMany` filter has nowhere to put them.
   */
  protected renderFilter<E extends Document>(
    entity: Type<E>,
    where: QueryWhere<E> = {},
    lookups?: RelationLookups,
  ): Filter<E> {
    const meta = getMeta(entity);
    const filter: Record<string, unknown> = {};
    for (const [rawKey, rawVal] of Object.entries(where)) {
      let key = rawKey;
      let val: unknown = rawVal;
      if (MongoDialect.isGroupOp(key)) {
        this.appendLogicalOperator(filter, entity, key, val as QueryWhereArray<E>, lookups);
      } else if (key === '$text') {
        // MongoDB's text index declares which fields it covers, so `$fields` cannot narrow the search
        // the way it does elsewhere - the same shape as `$distance` being index-defined here.
        const { $value, $config } = val as QueryTextSearchOptions<E>;
        filter['$text'] = { $search: $value, ...($config && { $language: textLanguage($config) }) };
      } else if (meta.relations[key]) {
        this.assertNoRaw(val);
        if (!lookups) {
          throw new TypeError(`filtering by relation '${key}' is not supported here on MongoDB`);
        }
        this.appendRelationLookup(filter, meta, key, val, lookups);
      } else {
        this.assertNoRaw(val);
        this.assertKnownPathRoot(meta, key);
        if (aggregateOf(meta.fields[key])) {
          if (!lookups) {
            throw new TypeError(`filtering by relation aggregate '${key}' is not supported here on MongoDB`);
          }
          this.appendAggregateField(meta, key, lookups);
        }
        const isReference = !!meta.fields[key]?.references;
        key = this.pathOf(meta, key);
        if ((key === MongoDialect.ID_KEY || isReference) && !isOperatorObject(val)) {
          val = this.toWireId(val);
        }
        if (!isOperatorObject(val)) {
          filter[key] = Array.isArray(val) ? { $in: val } : val;
          continue;
        }
        // MongoDB's `$size` takes only a number, so bounds become an `$expr` beside the other operators.
        const { $size: size, ...ops } = val;
        if (!isRecord(size)) {
          filter[key] = this.transformOperators(val);
        } else {
          MongoDialect.andExpr(filter, MongoDialect.arraySize(key, size));
          if (hasKeys(ops)) {
            filter[key] = this.transformOperators(ops);
          }
        }
      }
    }
    return filter as Filter<E>;
  }

  /**
   * Renders `$and`/`$or`/`$not`/`$nor` into `filter`, both negations as MongoDB's `$nor` (a `$not`'s clauses
   * wrapped in one `$and`), dropping empty clauses, since MongoDB refuses an empty operator.
   */
  private appendLogicalOperator<E extends Document>(
    filter: Record<string, unknown>,
    entity: Type<E>,
    key: QueryGroupOp,
    val: QueryWhereArray<E>,
    lookups?: RelationLookups,
  ): void {
    const { join, negate } = MongoDialect.GROUP_OPS[key];
    const parts = MongoDialect.groupClauses(key, val)
      .map((filterIt) => {
        this.assertNoRaw(filterIt);
        return this.renderFilter(entity, filterIt, lookups);
      })
      .filter((part) => Object.keys(part).length > 0);

    if (!parts.length) {
      return;
    }

    if (!negate) {
      filter[key] = parts;
      return;
    }

    const negated = join === '$and' && parts.length > 1 ? [{ $and: parts }] : parts;
    filter['$nor'] = [...((filter['$nor'] as Filter<E>[]) ?? []), ...negated];
  }

  /**
   * Emits the correlated `$lookup` for one relation condition, and adds to `filter` the condition testing
   * its result: presence of a row for a plain relation filter, a comparison against the row count for
   * `$size`. The target's (and, for ManyToMany, the junction's) own filters scope the lookup, so a
   * relation subquery can no more read out-of-scope rows than a direct query on the target can.
   */
  private appendRelationLookup<E>(
    filter: Record<string, unknown>,
    meta: EntityMeta<E>,
    relKey: string,
    val: unknown,
    lookups: RelationLookups,
  ): void {
    const temp = `${REL_TEMP_PREFIX}${lookups.temps.length}`;
    const sizeVal = parseRelationSize(val);
    const tail = sizeVal === undefined ? [{ $limit: 1 }] : [{ $count: AGGREGATE_VALUE_ALIAS }];
    const where = (sizeVal === undefined ? val : {}) as QueryWhere<object>;
    lookups.temps.push(temp);
    lookups.stages.push(this.relationLookup(meta, meta.relations[relKey]!, where, temp, tail));
    if (sizeVal === undefined) {
      filter[`${temp}.0`] = { $exists: true };
    } else {
      MongoDialect.andExpr(filter, MongoDialect.compareCount(this.tally(temp), sizeVal));
    }
  }

  /** Adds `expr` to `filter`'s `$expr`, `AND`ed with any already there. */
  private static andExpr(filter: Record<string, unknown>, expr: Record<string, unknown>): void {
    filter['$expr'] = filter['$expr'] ? { $and: [filter['$expr'], expr] } : expr;
  }

  /**
   * `$size` against bounds, which MongoDB's own `$size` takes only as a number: the array at `path` counted
   * in an `$expr`, which no other value satisfies. `$and` may evaluate every operand, so the count reads an
   * empty array in place of any other value.
   */
  private static arraySize(path: string, size: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const value = `$${path}`;
    const count = { $size: { $cond: [{ $isArray: value }, value, []] } };
    return { $and: [{ $isArray: value }, MongoDialect.compareCount(count, size)] };
  }

  /**
   * The correlated `$lookup` for the target rows of one relation `where` narrows, as `temp`: straight at
   * the target, or for a many-to-many from inside its junction's rows. The caller's filter bypass is not
   * passed down, as on the SQL dialects. `tail` decides what the lookup leaves behind - a row to test for
   * existence, or a `$count` - so a filter and an ordering build the same stage.
   */
  private relationLookup<E>(
    meta: EntityMeta<E>,
    relOpts: RelationMeta,
    where: QueryWhere<object>,
    temp: string,
    tail: MongoAggregationPipelineEntry<Document>[],
  ): MongoAggregationPipelineEntry<Document> {
    const relEntity = relOpts.entity();
    const relMeta = getMeta(relEntity);
    const targetScope = this.renderFilter(relEntity, this.scopedWhere(relMeta, where));
    const targetMatch = hasKeys(targetScope) ? [{ $match: targetScope }] : [];
    const from = this.resolveTableName(relMeta);
    if (!relOpts.through) {
      return {
        $lookup: { from, ...this.joinKeys(meta, relMeta, relOpts), pipeline: [...targetMatch, ...tail], as: temp },
      };
    }
    const junction = this.junctionOf(meta, relOpts, relMeta, relOpts.through());
    const target = {
      $lookup: {
        from,
        localField: junction.target,
        foreignField: MongoDialect.ID_KEY,
        pipeline: [...targetMatch, { $limit: 1 }],
        as: REL_NESTED_KEY,
      },
    };
    return {
      $lookup: {
        ...junction.lookup,
        pipeline: [...junction.scope, target, { $match: { [`${REL_NESTED_KEY}.0`]: { $exists: true } } }, ...tail],
        as: temp,
      },
    };
  }

  /**
   * The junction a many-to-many reaches its targets through: the lookup keys matching a parent's rows of
   * it, its own filters, since a soft-deleted link is not a link, and the field holding each target's id.
   * Each end is one field matched against one `_id`, so both sides must be sole-keyed.
   */
  private junctionOf<E>(
    meta: EntityMeta<E>,
    relOpts: RelationMeta,
    relMeta: EntityMeta<Document>,
    through: Type<Document>,
  ) {
    const throughMeta = getMeta(through);
    assertSoleId(meta, 'MongoDB');
    assertSoleId(relMeta, 'MongoDB');
    const [parentJoin] = parentJoins(relOpts, meta.ids.length);
    const [targetColumn] = targetKeyColumns(relOpts, meta.ids.length);
    const scope = this.renderFilter(through, this.scopedWhere(throughMeta, {}));
    return {
      lookup: {
        from: this.resolveTableName(throughMeta),
        localField: MongoDialect.ID_KEY,
        foreignField: this.columnOf(throughMeta, parentJoin.joined),
      },
      scope: hasKeys(scope) ? [{ $match: scope }] : [],
      target: this.columnOf(throughMeta, targetColumn),
    };
  }

  /** `count` compared with `size`, a number or its bounds, as an aggregation expression. */
  private static compareCount(
    count: unknown,
    size: number | Readonly<Record<string, unknown>>,
  ): Record<string, unknown> {
    if (typeof size === 'number') {
      return { $eq: [count, size] };
    }
    const comparisons: Record<string, unknown>[] = Object.entries(size)
      .filter(([, bound]) => bound !== undefined)
      .flatMap(([op, bound]): Record<string, unknown>[] =>
        op === '$between' && Array.isArray(bound)
          ? [{ $gte: [count, bound[0]] }, { $lte: [count, bound[1]] }]
          : [{ [op]: [count, bound] }],
      );
    if (!comparisons.length) {
      throw new TypeError('$size needs at least one comparison');
    }
    return comparisons.length === 1 ? comparisons[0] : { $and: comparisons };
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
    if (q.$lock) {
      throw new TypeError('$lock (row-level locking) is not supported on MongoDB');
    }
  }

  /** `raw()` renders SQL, so it has no MongoDB equivalent - say so instead of emitting `{}`. */
  private assertNoRaw<T>(value: T): asserts value is Exclude<T, QueryRaw> {
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
    if (root === MongoDialect.ID_KEY || meta.fields[root]) {
      return;
    }
    throw new TypeError(`path ${key} does not exist in ${entityName(meta)}`);
  }

  /** String operators -> { pattern: (v) => regex, caseInsensitive } */
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
        result[op] = this.held(val);
        continue;
      }
      // An object or an array is matched by what it holds, as the SQL engines read it, where native `$all`
      // compares the whole element. MongoDB takes `$elemMatch` there only when every value is one.
      if (op === '$all' && Array.isArray(val) && val.some((value) => Array.isArray(value) || isOperatorMap(value))) {
        result[op] = this.allHolding(val);
        continue;
      }
      // Native MongoDB operators - pass through directly
      if (MongoDialect.NATIVE_OPS.has(op as MongoNativeOp)) {
        result[op] = val;
        continue;
      }
      // String/pattern -> regex operators (8 variants including $like/$ilike)
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
        case '$near':
          // Atlas offers only a similarity threshold, on the index's own scale, which UQL neither emits nor
          // reads: converting a distance would mean guessing the metric, so this refuses.
          throw new TypeError(
            '$near is not supported on MongoDB: Atlas scores by index-defined similarity, not distance. ' +
              "Project the score with $sort's $project and filter on it instead.",
          );
        default:
          result[op] = val;
          break;
      }
    }
    return result;
  }

  /**
   * What a value holding `value` matches, as the SQL engines read it: an operator map tests it, an array
   * holds each element by `$all`, an object each key by {@link containment}, and a scalar is equal.
   */
  private held(value: unknown): unknown {
    if (Array.isArray(value)) {
      return this.transformOperators({ $all: value });
    }
    if (!isOperatorMap(value)) {
      return value;
    }
    return isOperatorObject(value) ? this.transformOperators(value) : this.containment(value);
  }

  /**
   * `$all` as one `$elemMatch` per value, since native `$all` never looks into an element that is an array:
   * an array element holds each of its values alike, an object or operator map as {@link held} reads it.
   */
  private allHolding(values: readonly unknown[]): Record<string, unknown>[] {
    return values.map((value) => {
      if (Array.isArray(value)) {
        return { $elemMatch: { $all: this.allHolding(value) } };
      }
      return { $elemMatch: isOperatorMap(value) ? this.held(value) : { $eq: value } };
    });
  }

  /** An object's keys as {@link held} reads each, a nested object's by its dotted path rather than whole. */
  private containment(object: Record<string, unknown>, prefix = ''): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(object).flatMap(([key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        return isJsonObject(value) ? Object.entries(this.containment(value, path)) : [[path, this.held(value)]];
      }),
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
        // A computed field writing SQL leaves the document nothing to project: refused asked for by
        // name, skipped swept in with the rest. A relation aggregate is on it by now, like any column.
        const field = meta.fields[key];
        if (field?.computed && !aggregateOf(field)) {
          if (selectMap && key in selectMap) {
            assertReadable(meta, key);
          }
          return acc;
        }
        acc[this.columnOf(meta, key)] = 1;
        return acc;
      },
      {},
    );
    // MongoDB returns `_id` unless it is explicitly excluded, so subtracting the primary key needs
    // `_id: 0` - the one inclusion/exclusion mix MongoDB allows - or `$exclude: { id: true }` would
    // have no effect at all.
    if (this.subtractsKey(soleIdOf(meta, 'MongoDB'), selectMap, exclude)) {
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
  public sort<E extends Document>(
    entity: Type<E>,
    { $sort: sort, $populate: populate, $where: where }: Query<E>,
  ): Sort {
    const meta = getMeta(entity);
    const normalized: Record<string, 1 | -1> = {};
    // Refused as the SQL dialects refuse it, before MongoDB answers a missing score with its own error.
    if (sort?.$text) {
      rankedTextSearch(where);
    }
    // The same join set the lookups are built from, so what an ordering may address and what the
    // pipeline actually produces cannot drift apart - `$sort` contributes its own to-one joins here
    // exactly as it does on the SQL dialects.
    this.collectSort(meta, sort, resolveQueryJoins(meta, { $populate: populate, $sort: sort }), '', normalized);
    return normalized;
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
      const relation = meta.relations[key];
      if (key === '$text') {
        if (path) {
          throw new TypeError(
            `$sort by $text is only supported on the queried entity, not on relation '${path.slice(0, -1)}'`,
          );
        }
        const { order, project } = textSortOf(sort)!;
        out[project ?? TEXT_SCORE_ALIAS] = sortDirection(order);
        continue;
      }
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
      const countDirection = parseSortByCount(value);
      if (countDirection !== undefined) {
        // The tally rides on a field {@link sortCountStages} adds, which only the queried entity's
        // own pipeline has: a nested one is built inside its parent's `$lookup`, where there is no
        // parent document left to hang it off.
        if (path) {
          throw new TypeError(`$sort by '${relPath}.$count' is only supported on the queried entity`);
        }
        out[sortCountField(key)] = sortDirection(countDirection);
        continue;
      }
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

  /**
   * The stages a `$sort` by a relation's size needs: one correlated `$lookup` tallying the relation
   * per parent, and the `$set` that lifts the tally onto the document as the field the `$sort` then
   * orders by. A parent with no related row gets no lookup result at all, which is a zero.
   */
  public sortCountStages<E extends Document>(
    entity: Type<E>,
    sort: QuerySortMap<E> | undefined,
  ): { readonly stages: MongoAggregationPipelineEntry<Document>[]; readonly fields: string[] } {
    const meta = getMeta(entity);
    const stages: MongoAggregationPipelineEntry<Document>[] = [];
    const fields: string[] = [];

    for (const [key, value] of Object.entries(sort ?? {})) {
      const relOpts = meta.relations[key];
      if (!relOpts || parseSortByCount(value) === undefined) {
        continue;
      }
      const temp = sortCountField(key);
      stages.push(...this.aggregateStages(meta, { relation: key, op: '$count' }, `${REL_TEMP_PREFIX}${temp}`, temp));
      fields.push(temp);
    }

    return { stages, fields };
  }

  /** Whether a read answers with a relation aggregate, which only the pipeline can build. */
  public readsAggregates<E extends Document>(entity: Type<E>, q: Query<E>): boolean {
    return this.aggregateKeys(entity, q).length > 0;
  }

  /** The relation aggregates a read projects or sorts by; its `$where` puts its own on the document. */
  private aggregateKeys<E extends Document>(entity: Type<E>, q: Query<E>): string[] {
    const meta = getMeta(entity);
    const projected = normalizeScalarFieldSelection(meta, asSelectMap(q.$select), q.$exclude);
    return [...projected, ...Object.keys(q.$sort ?? {})].filter((key) => aggregateOf(meta.fields[key]));
  }

  /**
   * The relation aggregate `key` computes, put on the document under its column by the stages
   * {@link aggregateStages} builds from the same spec SQL renders as a subquery. Once however many
   * clauses read it; a key computing none adds nothing.
   */
  private appendAggregateField<E>(meta: EntityMeta<E>, key: string, lookups: RelationLookups): void {
    const spec = aggregateOf(meta.fields[key]);
    const temp = `${REL_TEMP_PREFIX}${key}`;
    if (!spec || lookups.temps.includes(temp)) {
      return;
    }
    lookups.temps.push(temp);
    lookups.stages.push(...this.aggregateStages(meta, spec, temp, this.columnOf(meta, key)));
  }

  /**
   * One relation aggregate on the document under `field`: the correlated lookup that reads the related
   * rows - narrowed, ordered and capped as the spec says - ending in the tally or total it wants, and
   * the `$addFields` reading that back, `0` or `null` where the lookup matched nothing.
   *
   * Every aggregate MongoDB answers is built here: a `$count` a query asks for, an ordering by one, and
   * a field a `computed` declares, which is the same spec the SQL dialects render as one subquery.
   */
  private aggregateStages<E>(
    meta: EntityMeta<E>,
    spec: RelationAggregateSpec,
    temp: string,
    field: string,
  ): MongoAggregationPipelineEntry<Document>[] {
    const relOpts = relationOf(meta, spec.relation as RelationKey<E>);
    const page = spec.page ?? {};
    const tail = [
      ...(page.$sort ? [{ $sort: this.sort(relOpts.entity(), page) }] : []),
      ...this.pagerStages(page),
      spec.field
        ? {
            $group: {
              _id: null,
              [AGGREGATE_VALUE_ALIAS]: { [spec.op]: `$${this.columnOf(getMeta(relOpts.entity()), spec.field)}` },
            },
          }
        : { $count: AGGREGATE_VALUE_ALIAS },
    ];
    return [
      this.relationLookup(meta, relOpts, spec.where ?? {}, temp, tail),
      { $addFields: { [field]: this.tally(temp, spec.op) } },
    ];
  }

  /**
   * The value a lookup left in `temp`, which holds no row at all where nothing matched: `0` for the
   * aggregates that count something, and `null` for the ones with no value to report.
   */
  private tally(temp: string, op: RelationAggregateOp = '$count'): Record<string, unknown> {
    const empty = op === '$count' || op === '$sum' ? 0 : null;
    return { $ifNull: [{ $arrayElemAt: [`$${temp}.${AGGREGATE_VALUE_ALIAS}`, 0] }, empty] };
  }

  /**
   * The lookups reading each to-many a query populates, and the tally of each `$count`, onto the fields
   * its rows answer under, and the fields they parked a junction's pairings or a tally on taken back out.
   * [The design](../../../../architecture/relations-in-one-statement.md).
   */
  private relationReadStages<E extends Document>(
    entity: Type<E>,
    q: Query<E>,
  ): MongoAggregationPipelineEntry<Document>[] {
    const meta = getMeta(entity);
    const stages: MongoAggregationPipelineEntry<Document>[] = [];
    const temps: string[] = [];
    for (const relKey of getRelationRequestSummary(meta, q.$populate).toManyKeys) {
      stages.push(...this.toManyLookup(meta, relKey, parseRelationAtKey(relKey, q.$populate).query, temps));
    }
    for (const { relKey, where } of countedRelations(meta, q.$count)) {
      const temp = `${REL_TEMP_PREFIX}count_${relKey}`;
      temps.push(temp);
      const spec: RelationAggregateSpec = { relation: relKey, op: '$count', where };
      stages.push(...this.aggregateStages(meta, spec, temp, `${COUNT_RESULT_KEY}.${relKey}`));
    }
    return temps.length ? [...stages, { $unset: temps }] : stages;
  }

  /**
   * A to-many's rows as a lookup running their own read, whose filters, ordering and page apply per
   * parent inside it. A many-to-many reads its targets, each once, by the ids its junction pairs the
   * parent with, parked in a temporary field of the parent's.
   */
  private toManyLookup<E>(
    meta: EntityMeta<E>,
    relKey: RelationKey<E>,
    query: RelationQuery,
    temps: string[],
  ): MongoAggregationPipelineEntry<Document>[] {
    const relOpts = relationOf(meta, relKey);
    const relEntity = relOpts.entity();
    const relMeta = getMeta(relEntity);
    const read = this.aggregationPipeline(relEntity, query);
    const pipeline = read.length ? { pipeline: read } : {};
    const from = this.resolveTableName(relMeta);
    if (!relOpts.through) {
      return [{ $lookup: { from, ...this.joinKeys(meta, relMeta, relOpts), ...pipeline, as: relKey } }];
    }
    const junction = this.junctionOf(meta, relOpts, relMeta, relOpts.through());
    const temp = `${REL_TEMP_PREFIX}${relKey}`;
    temps.push(temp);
    return [
      {
        $lookup: {
          ...junction.lookup,
          pipeline: [...junction.scope, { $project: { [junction.target]: 1 } }],
          as: temp,
        },
      },
      {
        $lookup: {
          from,
          localField: `${temp}.${junction.target}`,
          foreignField: MongoDialect.ID_KEY,
          ...pipeline,
          as: relKey,
        },
      },
    ];
  }

  /** Whether a `$sort` reads a relation, which is what forces the lookups to run before it. */
  public sortsRelations<E extends Document>(entity: Type<E>, sort: QuerySortMap<E> | undefined): boolean {
    if (!sort) {
      return false;
    }
    const meta = getMeta(entity);
    return someKey(sort, (key) => !!meta.relations[key]);
  }

  /**
   * Aggregate results are keyed by `$group`/`$select` alias rather than by column, so an aggregate
   * `$sort` addresses those aliases as-is - the same reason the SQL dialects sort by alias there.
   */
  private aliasSort(sort: Record<string, unknown>): Sort {
    const normalized: Record<string, 1 | -1> = {};
    for (const [alias, dir] of Object.entries(sort)) {
      normalized[alias] = sortDirection(dir);
    }
    return normalized;
  }

  /**
   * {@link columnOf} for a possibly dotted key: only the root is a field key, the rest addresses an
   * embedded path (`kind.city` -> `<kind's column>.city`).
   */
  private pathOf<E>(meta: EntityMeta<E>, key: string): string {
    const dot = key.indexOf('.');
    if (dot < 0) {
      assertReadable(meta, key);
      return this.columnOf(meta, key);
    }
    return this.columnOf(meta, key.slice(0, dot)) + key.slice(dot);
  }

  public aggregationPipeline<E extends Document>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
  ): MongoAggregationPipelineEntry<E>[] {
    // Sorted as a field, which goes either way where a `$meta` sort only descends.
    const text = textSortOf(q.$sort);
    return [
      ...this.matchStages(entity, q.$where, opts, this.aggregateKeys(entity, q)),
      ...this.readStages(entity, q, {
        sort: this.sort(entity, q),
        pager: this.pagerStages(q),
        score: text && { field: text.project ?? TEXT_SCORE_ALIAS, meta: 'textScore', temporary: !text.project },
      }),
    ];
  }

  /** The `$skip`/`$limit` stages of a page, each checked: `/http` hands a page over untyped. */
  public pagerStages(q: QueryPager): MongoAggregationPipelineEntry<Document>[] {
    return [
      ...(q.$skip === undefined ? [] : [{ $skip: assertNonNegativeInteger(q.$skip, '$skip') }]),
      ...(q.$limit === undefined ? [] : [{ $limit: assertNonNegativeInteger(q.$limit, '$limit') }]),
    ];
  }

  /**
   * What a read runs after its entry stage, in the one order that works: the lookups, then the sort and
   * page that may read them, then the projection. Shared with the `$vectorSearch` pipeline.
   */
  public readStages<E extends Document>(
    entity: Type<E>,
    q: Query<E>,
    extra: MongoReadStages = {},
  ): MongoAggregationPipelineEntry<Document>[] {
    const meta = getMeta(entity);
    const joins = resolveQueryJoins(meta, q);
    // The tally an ordering by a relation's size reads, and the field it parks it on: both belong
    // with the lookups, since the `$sort` right after them is what they exist for.
    const counted = this.sortCountStages(entity, q.$sort);
    const lookups = [...this.lookupStages(meta, joins), ...counted.stages];
    // Each to-many and each `$count`, which neither drop nor reorder a row, so they read the page alone.
    const related = this.relationReadStages(entity, q);
    const sort = hasKeys(extra.sort) ? [{ $sort: extra.sort }] : [];
    const pager = extra.pager ?? [];

    // The score becomes a real field before anything reads it, so the lookups, the sort and the projection
    // that follow treat it like any other; merged into the query's own projection rather than standing in
    // for one, since a query that asked for no columns wants the whole document as well.
    const { score } = extra;
    if (score && !score.temporary) {
      this.assertProjectable(meta, score.field);
    }
    const scored = score ? [{ $addFields: { [score.field]: { $meta: score.meta } } }] : [];
    const unscored = score?.temporary ? [{ $unset: [score.field] }] : [];
    const projection = this.pipelineProjection(entity, q);
    const projected = projection && score ? { ...projection, [score.field]: 1 as const } : projection;
    const project = projected ? [{ $project: projected }] : [];

    // A `$lookup` the ordering asked for puts a field on the document the caller never requested,
    // which is the one way this differs from a SQL join. Taken back out once the `$sort` that needed
    // it has run, so ordering by an unpopulated relation costs the same nothing it does there.
    const sortOnly = [...joins.values()].filter((join) => !join.projected).map((join) => join.path);
    const dropped = [...sortOnly, ...counted.fields];
    const unset = dropped.length ? [{ $unset: dropped }] : [];

    // The grouping collapses rows onto the columns it projects, which leaves nothing for an ordering
    // that reads a lookup those columns do not carry. Refused rather than answered all-equal, and in
    // the same terms the SQL dialects refuse `SELECT DISTINCT` ordered by an unselected column.
    if (q.$distinct && counted.fields.length) {
      throw new TypeError(
        `cannot $sort by a relation's $count with $distinct: the grouping keeps only the columns it projects`,
      );
    }
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
      return [...scored, ...lookups, ...related, ...project, ...dedup, ...sort, ...pager, ...unscored];
    }

    // A `$required` relation drops parents when it unwinds, and an ordering may read a field only a
    // lookup produces: either one puts the lookups first, as an INNER JOIN does. Otherwise paging
    // first is equivalent and spares the lookups the rows it cuts.
    const lookupsFirst =
      this.sortsRelations(entity, q.$sort) ||
      lookups.some((stage) => stage.$unwind?.preserveNullAndEmptyArrays === false);
    return [
      ...scored,
      ...(lookupsFirst ? [...lookups, ...sort, ...pager] : [...sort, ...pager, ...lookups]),
      ...related,
      ...unset,
      ...project,
      ...unscored,
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
   * The projection a narrowing query asks for, widened by what the pipeline produced (each populated
   * relation and the tallies); last, once the lookups have read the join keys.
   */
  public pipelineProjection<E extends Document>(entity: Type<E>, q: Query<E>): Record<string, 0 | 1> | undefined {
    if (!q.$select && !q.$exclude) {
      return undefined;
    }
    const projection = this.select(entity, q.$select, q.$exclude);
    for (const relKey of getRelationRequestSummary(getMeta(entity), q.$populate).requestedKeys) {
      projection[relKey] = 1;
    }
    if (q.$count) {
      projection[COUNT_RESULT_KEY] = 1;
    }
    return projection;
  }

  /**
   * The `$lookup`/`$unwind` pair for each relation joined below `parent`, its own relations nested
   * inside its pipeline and resolved before the projection that reads them.
   */
  private lookupStages<P>(
    parentMeta: EntityMeta<P>,
    joins: QueryJoins,
    parent?: QueryJoin,
  ): MongoAggregationPipelineEntry<Document>[] {
    const pipeline: MongoAggregationPipelineEntry<Document>[] = [];

    // Every join at this level hangs off `parent`, so its metadata is `parentMeta` - no branch, and
    // no union of two unrelated entity types to resolve the join column through.
    for (const join of joins.values()) {
      if (join.parent !== parent) {
        continue;
      }
      // Unconditional, not gated by an explicit relation-level `$where`: the related entity's own
      // filters (in particular `security: true` ones) apply even to a bare `$populate: { rel: true }`,
      // and the caller's bypass never reaches them, exactly like the SQL dialects' JOIN ON-clause filters.
      const relationFilter = this.where(join.entity, join.query.$where ?? {});
      // The relation's own projection runs inside the lookup, where its keys resolve against the
      // related entity. Left out, `$populate: { rel: { $select } }` returned all of `rel`'s columns.
      const relationProjection = this.pipelineProjection(join.entity, join.query);
      // MongoDB returns `_id` unless a projection subtracts it, so dropping the key from the map is
      // how a joined document keeps its own id, as it does on the SQL dialects.
      delete relationProjection?.[MongoDialect.ID_KEY];

      const lookupPipeline = [
        ...(hasKeys(relationFilter) ? [{ $match: relationFilter }] : []),
        ...this.lookupStages(join.meta, joins, join),
        ...this.relationReadStages(join.entity, join.query),
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
    if (relOpts.cardinality === 'm1') {
      // The target's side, not this entity's: a lookup matches one `localField` against one
      // `foreignField`, so a composite target would join on its first column alone and gather the
      // rows of every key that agrees on it. The other branch is refused by `columnOf` below, whose
      // key *is* an id column; this one names a plain foreign key, so it has to say so itself.
      assertSoleId(relMeta, 'MongoDB');
      return { localField: this.columnOf(meta, relOpts.references[0].local), foreignField: MongoDialect.ID_KEY };
    }
    return { localField: MongoDialect.ID_KEY, foreignField: this.columnOf(relMeta, relOpts.references[0].foreign) };
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

  private referenceKeys<E>(meta: EntityMeta<E>): readonly string[] {
    let keys = this.#referenceKeys.get(meta);
    if (!keys) {
      keys = getKeys(meta.fields).filter((key) => meta.fields[key]?.references);
      this.#referenceKeys.set(meta, keys);
    }
    return keys;
  }

  // Keyed by the meta object itself; entity metadata is immutable once defined.
  readonly #renamedColumns = new WeakMap<object, readonly [string, string][]>();
  readonly #referenceKeys = new WeakMap<object, readonly string[]>();

  public normalizeIds<E extends Document>(meta: EntityMeta<E>, docs: Document[]): E[] {
    return docs.map((doc) => this.normalizeId(meta, doc)) as E[];
  }

  /** `doc` is the wire shape - `_id`, stored names, `ObjectId`s - and what comes back is the code's. */
  public normalizeId<E extends Document>(meta: EntityMeta<E>, doc: Document | undefined): E | undefined {
    if (!doc) {
      return doc;
    }

    const res = doc as Record<string, unknown>;
    const _id = MongoDialect.ID_KEY;

    // `!== undefined`, not truthiness: `0` is a key MongoDB accepts and a truthy test dropped it.
    if (res[_id] !== undefined) {
      const idKey = soleIdOf(meta, 'MongoDB');
      res[idKey] = this.fromWireId(res[_id]);
      if (idKey !== _id) {
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
    // After the rename, so a renamed reference is converted under the name the code reads.
    for (const key of this.referenceKeys(meta)) {
      if (res[key] !== undefined) {
        res[key] = this.fromWireId(res[key]);
      }
    }
    // A 64-bit integer, which the pool reads as a `bigint`: kept for a `BigInt` field, and elsewhere the
    // number it is where exact and its exact text past 2^53, as every SQL driver decodes one.
    decodeBigIntsExcept(res, (key) => meta.fields[key as FieldKey<E>]?.type === BigInt);

    const relKeys = getKeys(meta.relations).filter((key) => res[key]) as RelationKey<E>[];

    for (const relKey of relKeys) {
      const relMeta = getMeta(relationOf(meta, relKey).entity());
      res[relKey] = Array.isArray(res[relKey])
        ? this.normalizeIds(relMeta, res[relKey] as Document[])
        : this.normalizeId(relMeta, res[relKey] as Document);
    }

    return res as E;
  }

  /** An aggregate's rows with each 64-bit integer decoded as a document's is: a `bigint` only where the column reads a `BigInt` field. */
  public normalizeAggregateRows<
    E extends Document,
    const G extends QueryGroupMap<E>,
    const A extends QueryAggMap<E>,
    R extends Document,
  >(entity: Type<E>, q: QueryAggregate<E, G, A>, rows: R[]): R[] {
    const meta = getMeta(entity);
    const { joins } = resolveGroupJoins(meta, q);
    const exact = new Set(
      parseGroupMap(q.$group, q.$select)
        .filter((entry) => aggregateColumnField(meta, joins, entry)?.field?.type === BigInt)
        .map((entry) => entry.alias),
    );
    for (const row of rows) {
      decodeBigIntsExcept(row, (key) => exact.has(key));
    }
    return rows;
  }

  /**
   * A key as MongoDB stores it: a 24-hex string as an `ObjectId`, so a write matches the filter looking for
   * it, and anything else as given. Only 24-hex, not any 12-byte string. Arrays convert element-wise.
   */
  public toWireId(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((it) => this.toWireId(it));
    }
    return typeof value === 'string' && HEX_24.test(value) ? new ObjectId(value) : value;
  }

  /** The seam out of the driver: an `ObjectId` becomes its hex string, the type the code declares. */
  public fromWireId(value: unknown): unknown {
    return value instanceof ObjectId ? value.toHexString() : value;
  }

  public getPersistable<E extends Document>(
    meta: EntityMeta<E>,
    payload: EntityData<E>,
    callbackKey: CallbackKey,
  ): Partial<E> {
    return this.getPersistables(meta, payload, callbackKey)[0];
  }

  /** One MongoDB update document's operators, grouped by kind and keyed by dotted path. */
  private groupUpdateOperators<E extends Document>(persistable: Partial<E>): UpdateGroups {
    const set: Document = {};
    const push: Document = {};
    const pull: Document = {};
    const arithmetic: Document = {};
    const unset = new Set<string>();
    for (const [key, value] of Object.entries(persistable)) {
      if (isFieldUpdateOp(value)) {
        const [op, operand] = fieldUpdateOf(key, value);
        arithmetic[key] = { [MONGO_ARITHMETIC[op]]: [{ $ifNull: [`$${key}`, 0] }, { $literal: operand }] };
        continue;
      }
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
    return { set, push, pull, arithmetic, unset };
  }

  /**
   * Turn a persistable payload into a MongoDB update, mapping UQL's JSON operators onto their native
   * equivalents: `$set` becomes dotted-path assignments, `$unset`/`$push`/`$pull` map one-to-one.
   * Plain field values are assigned with `$set`.
   */
  public getUpdateFilter<E extends Document>(persistable: Partial<E>): UpdateFilter<E> | Document[] {
    const groups = this.groupUpdateOperators(persistable);
    const { set, push, pull, arithmetic, unset } = groups;
    const exprKeys = [...Object.keys(pull), ...Object.keys(set), ...Object.keys(push)];

    // Native `$pull` fails on a value that is no array, native `$inc`/`$mul` on a `null`, and MongoDB
    // rejects two operators targeting one path in a single update document: each forces the pipeline form.
    const allPaths = [...exprKeys, ...unset];
    if (hasKeys(pull) || hasKeys(arithmetic) || new Set(allPaths).size < allPaths.length) {
      return this.getUpdatePipeline(groups, new Set(exprKeys));
    }
    return {
      ...(hasKeys(set) && { $set: set }),
      ...(hasKeys(push) && { $push: push }),
      ...(unset.size > 0 && { $unset: Object.fromEntries([...unset].map((path) => [path, ''])) }),
    } as UpdateFilter<E>;
  }

  /**
   * An update as one pipeline, since MongoDB refuses two operators on one path: each path composed as
   * `$pull`, `$set`, `$push`, then `$unset`, as SQL does, with values as `$literal` so `$x` stays data.
   */
  private getUpdatePipeline(
    { set, push, pull, arithmetic, unset }: UpdateGroups,
    exprPaths: ReadonlySet<string>,
  ): Document[] {
    const assignments: Document = { ...arithmetic };
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
      // Only `$set` and `$push` create a key. A `$pull` alone leaves any value that is no array as it is,
      // and an absent one absent, since a pipeline `$set` of a missing field adds none.
      assignments[path] = path in set || path in push ? expr : { $cond: [{ $isArray: `$${path}` }, expr, `$${path}`] };
    }
    return [{ $set: assignments }, ...(unset.size > 0 ? [{ $unset: [...unset] }] : [])];
  }

  /** Refuses a key left to MongoDB that it cannot mint: only an `ObjectId`, read back as a string, so not a `Number`. */
  private assertMintableKey<E>(meta: EntityMeta<E>, field: FieldOptions): void {
    if (columnFamily(field.type) === 'string') {
      return;
    }
    throw new TypeError(
      `'${entityName(meta)}.${meta.ids[0]}' is declared '${declaredTypeName(field.type)}' and left to the ` +
        'database, which MongoDB cannot do: the only key it generates is an ObjectId, read back as a string. ' +
        "Declare the key as a string, or give it an 'onInsert' generator.",
    );
  }

  public getPersistables<E extends Document>(
    meta: EntityMeta<E>,
    payload: EntityData<E> | EntityData<E>[],
    callbackKey: CallbackKey,
  ): Partial<E>[] {
    // What `columnOf` refuses, a write has to refuse too.
    assertSoleId(meta, 'MongoDB');
    const [idKey] = meta.ids;
    const payloads = fillOnFields(meta, payload, callbackKey);
    // Keys are resolved per document so heterogeneous payloads keep every provided field.
    const inserting = callbackKey === 'onInsert';
    return payloads.map((it) => {
      // The key is `_id` on an insert and immutable on an update, so it is left out of one. It used
      // to land under its own name beside the `_id` the driver minted: a supplied id, or one an
      // `onInsert` generated, was written and unreachable by the value the caller held.
      const named = inserting && it[idKey] != null;
      if (inserting && !named) {
        // Nothing named the key, so the database is being asked to mint one.
        this.assertMintableKey(meta, fieldOf(meta, idKey));
      }
      const doc: Record<string, unknown> = named ? { [MongoDialect.ID_KEY]: this.toWireId(it[idKey]) } : {};
      for (const key of filterFieldKeys(meta, it, callbackKey)) {
        if (key === idKey) continue;
        const field = meta.fields[key]!;
        doc[this.resolveColumnName(key, field)] = field.references ? this.toWireId(it[key]) : it[key];
      }
      return doc as Partial<E>;
    });
  }

  /**
   * Build MongoDB aggregation pipeline stages from a QueryAggregate.
   */
  public buildAggregateStages<E extends Document, const G extends QueryGroupMap<E>, const A extends QueryAggMap<E>>(
    entity: Type<E>,
    q: QueryAggregate<E, G, A>,
    opts?: QueryOptions,
  ): MongoAggregationPipelineEntry<Document>[] {
    const meta = getMeta(entity);
    const { joins, where } = resolveGroupJoins(meta, q);
    const { groupId, accumulators, columns, named } = this.buildGroupSpec(
      meta,
      parseGroupMap(q.$group, q.$select),
      joins,
    );
    const pipeline: MongoAggregationPipelineEntry<Document>[] = [
      ...this.matchStages(entity, where, opts, named),
      ...this.lookupStages(meta, joins),
      { $group: { _id: hasKeys(groupId) ? groupId : null, ...accumulators } },
      // `$group` answers with `_id` even when grouping by nothing, and with what `columns` read to the end.
      { $project: { _id: 0, ...columns } },
    ];

    // Everything the pipeline emits, which is all `$having` and `$sort` may name. The `$project`
    // above has already dropped the rest, so an unchecked key matched nothing or ordered by nothing.
    const emitted = new Set(Object.keys(columns));

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

    pipeline.push(...this.pagerStages(q));
    return pipeline;
  }

  /**
   * Resolve parsed group entries into the `_id` keys and accumulators of a `$group` stage, and the
   * `columns` its `$project` reads each result from: a group key out of `_id`, a DISTINCT set by its
   * size, and a `$sum` as null where it read no value, as SQL answers it. `named` is every field it reads,
   * filters included, so each relation aggregate among them is put on the document first.
   */
  private buildGroupSpec<E>(
    meta: EntityMeta<E>,
    groupEntries: ParsedGroupEntry<E>[],
    joins: QueryJoins,
  ): {
    groupId: Record<string, string>;
    accumulators: Record<string, Record<string, unknown>>;
    columns: Record<string, unknown>;
    named: string[];
  } {
    if (!groupEntries.length) {
      throw new TypeError('aggregate requires at least one $group column or $select function');
    }
    const groupId: Record<string, string> = {};
    const accumulators: Record<string, Record<string, unknown>> = {};
    const columns: Record<string, unknown> = {};
    const named: string[] = [];

    for (const entry of groupEntries) {
      // Aliases stay as the caller wrote them ($project maps them back); the *refs* address columns.
      if (entry.kind === 'key') {
        groupId[entry.alias] = `$${this.groupedPath(meta, joins, entry.path, named)}`;
        columns[entry.alias] = `$_id.${entry.alias}`;
        continue;
      }
      const { field } = entry;
      if (field !== undefined) {
        named.push(field);
      }
      const test = entry.where && this.whereExpression(meta, entry.where, named);
      // What the accumulator reads from a row its own `$where` passes, and from one it does not.
      const read = (passed: unknown, failed: unknown) => (test ? { $cond: [test, passed, failed] } : passed);
      columns[entry.alias] = 1;
      if (field === undefined) {
        // COUNT(*): every row, as SQL counts one.
        accumulators[entry.alias] = { $sum: read(1, 0) };
        continue;
      }
      const ref = `$${this.columnOf(meta, field)}`;
      if (entry.distinct) {
        accumulators[entry.alias] = { $addToSet: read(ref, '$$REMOVE') };
        columns[entry.alias] = { $size: `$${entry.alias}` };
      } else if (entry.op === '$count') {
        // COUNT(field) counts the non-null values, as SQL does.
        accumulators[entry.alias] = { $sum: read(MongoDialect.countOf(ref), 0) };
      } else {
        // `$sum`, `$avg`, `$min` and `$max` are MongoDB accumulators of the same name, and skip a null.
        accumulators[entry.alias] = { [entry.op]: read(ref, null) };
      }
      if (entry.op === '$sum' && !entry.distinct) {
        const counted = `${SUM_COUNT_ALIAS}_${entry.alias}`;
        accumulators[counted] = { $sum: read(MongoDialect.countOf(ref), 0) };
        columns[entry.alias] = { $cond: [{ $eq: [`$${counted}`, 0] }, null, `$${entry.alias}`] };
      }
    }

    return { groupId, accumulators, columns, named };
  }

  /** `1` where `ref` holds a value, `0` where it is null or missing, which an expression tells apart. */
  private static countOf(ref: string): Record<string, unknown> {
    return { $cond: [MongoDialect.isNullExpr(ref), 0, 1] };
  }

  /** Whether `ref` is null or missing: an expression compares a missing field as neither. */
  private static isNullExpr(ref: string): Record<string, unknown> {
    return { $eq: [{ $ifNull: [ref, null] }, null] };
  }

  /** The field a grouped path reads, on the document or on the joined one its lookup unwound. */
  private groupedPath<E>(meta: EntityMeta<E>, joins: QueryJoins, path: readonly string[], named: string[]): string {
    const { key, join } = groupPathField(joins, path);
    if (!join) {
      named.push(key);
      return this.columnOf(meta, key);
    }
    if (aggregateOf(join.meta.fields[key])) {
      throw new TypeError(
        `cannot $group by '${path.join('.')}' on MongoDB: a joined row's relation aggregate is not read`,
      );
    }
    return `${join.path}.${this.columnOf(join.meta, key)}`;
  }

  /**
   * An aggregate's own `$where` as the expression a `$cond` tests, which a query filter is not: the
   * comparisons and the logical operators translate, anything else is refused by name. `named` gathers
   * the fields it reads, so a relation aggregate among them is on the document first.
   */
  private whereExpression<E>(meta: EntityMeta<E>, where: QueryWhere<E>, named: string[]): unknown {
    const terms = getKeys(where)
      .filter((key) => where[key] !== undefined)
      .map((key): unknown => {
        if (MongoDialect.isGroupOp(key)) {
          const { join, negate } = MongoDialect.GROUP_OPS[key];
          const clauses = MongoDialect.groupClauses(key, where[key]).map((clause) => {
            if (clause instanceof QueryRaw) {
              throw new TypeError('raw SQL is not supported in an aggregate $where on MongoDB');
            }
            return this.whereExpression(meta, clause, named);
          });
          return negate ? { $not: [{ [join]: clauses }] } : { [join]: clauses };
        }
        if (key.startsWith('$')) {
          throw new TypeError(`aggregate $where operator '${key}' is not supported on MongoDB`);
        }
        const val: unknown = where[key];
        named.push(key);
        const path = this.pathOf(meta, key);
        const wire = (value: unknown) =>
          path === MongoDialect.ID_KEY || meta.fields[key]?.references ? this.toWireId(value) : value;
        return this.fieldExpression(`$${path}`, val, wire);
      });
    return terms.length === 1 ? terms[0] : { $and: terms };
  }

  /** One field's condition as an expression: a value it equals, a list it is in, or a map of comparisons. */
  private fieldExpression(ref: string, val: unknown, wire: (value: unknown) => unknown): unknown {
    const equals = (value: unknown) => (value === null ? MongoDialect.isNullExpr(ref) : { $eq: [ref, wire(value)] });
    if (!isOperatorMap(val)) {
      return Array.isArray(val) ? { $in: [ref, wire(val)] } : equals(val);
    }
    // A null or missing field compares below every value in an expression, where SQL leaves it unmatched.
    const present = { $not: [MongoDialect.isNullExpr(ref)] };
    const terms = Object.entries(val).map(([op, operand]): unknown => {
      switch (op) {
        case '$eq':
          return equals(operand);
        case '$ne':
          return { $not: [equals(operand)] };
        case '$gt':
        case '$gte':
          return { [op]: [ref, wire(operand)] };
        case '$lt':
        case '$lte':
          return { $and: [present, { [op]: [ref, wire(operand)] }] };
        case '$in':
          return { $in: [ref, wire(operand)] };
        case '$nin':
          return { $not: [{ $in: [ref, wire(operand)] }] };
        case '$between': {
          const [min, max] = operand as [unknown, unknown];
          return { $and: [{ $gte: [ref, wire(min)] }, { $lte: [ref, wire(max)] }] };
        }
        case '$isNull':
          return operand ? MongoDialect.isNullExpr(ref) : present;
        case '$isNotNull':
          return operand ? present : MongoDialect.isNullExpr(ref);
        default:
          throw new TypeError(`aggregate $where operator '${op}' is not supported on MongoDB`);
      }
    });
    return terms.length === 1 ? terms[0] : { $and: terms };
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
    const found = sort && findVectorSort(sort);
    if (!found) {
      return undefined;
    }
    // The remaining entries order the rows the vector stage already picked, so they stay a `$sort`.
    // Copied in one pass rather than `entries().filter().fromEntries()`, which walks the map three
    // times over. Every key of the map is optional, so dropping one leaves a valid map - which
    // neither `Omit` nor a computed-key rest can say over a mapped type with no index signature.
    const regularSort: Record<string, unknown> = {};
    for (const key of getKeys(sort)) {
      if (key !== found.key) {
        regularSort[key] = sort[key];
      }
    }
    return { vectorKey: found.key, vectorSearch: found.search, regularSort: regularSort as QuerySortMap<E> };
  }

  /** The Atlas index a `$vectorSearch` over `column` reads, and migrations create: its declared name, else `<column>_index`. */
  protected vectorSearchIndexName(name: string | undefined, column: string): string {
    return name ?? `${column}_index`;
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
    candidates?: number,
  ): MongoAggregationPipelineEntry<Document> {
    const meta = getMeta(entity);
    const field = meta.fields[key];
    if (!field) {
      throw new TypeError(`Field '${key}' not found in entity '${meta.name}'`);
    }
    const colName = this.resolveColumnName(key, field);

    const indexName = this.vectorSearchIndexName(findVectorIndex(meta, key)?.name, colName);

    if (!limit) {
      throw new TypeError(`$vectorSearch requires $limit (vector sort on '${key}' of '${meta.name}')`);
    }

    const stage: Record<string, unknown> = {
      index: indexName,
      path: colName,
      queryVector: [...search.$vector],
      // `$candidates` is the caller's own budget; the fallback is 10x the limit, which is what Atlas
      // suggests as a floor. Either way it is clamped: Atlas rejects a stage asking for more.
      numCandidates: Math.min(candidates ?? limit * 10, MongoDialect.MAX_NUM_CANDIDATES),
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
  $lookup?: MongoAggregationLookup;
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

/** A `$lookup`, whose pipeline runs over the collection it reads. */
type MongoAggregationLookup = {
  readonly from?: string;
  readonly foreignField?: string;
  readonly localField?: string;
  readonly pipeline?: MongoAggregationPipelineEntry<Document>[];
  /** A relation key when populating, a temporary field when a relation condition is being tested. */
  readonly as?: string;
};

type MongoAggregationUnwind = {
  readonly path?: string;
  readonly preserveNullAndEmptyArrays?: boolean;
};

export type ExtractedVectorSort<E> = {
  readonly vectorKey: string;
  readonly vectorSearch: QueryVectorSearch;
  readonly regularSort: QuerySortMap<E>;
};

/** `-1` for the two descending spellings, `1` for everything else - MongoDB knows no other value. */
function sortDirection(value: unknown): 1 | -1 {
  return value === 'desc' || value === -1 ? -1 : 1;
}

/**
 * A `computed` field writing SQL is refused wherever a query names it, since no document engine
 * evaluates SQL and answering with the property name would hand back `undefined` for every row. One
 * computing a relation aggregate is read: `appendAggregateField` builds it.
 */
function assertReadable<E>(meta: EntityMeta<E>, key: string): void {
  const field = meta.fields[key];
  if (field?.computed && !aggregateOf(field)) {
    throw new TypeError(
      `cannot read '${meta.entity.name}.${key}' on MongoDB: a 'computed' field writing SQL is not something a document engine evaluates`,
    );
  }
}
