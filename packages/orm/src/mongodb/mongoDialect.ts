import { type Document, type Filter, ObjectId, type Sort } from 'mongodb';
import { AbstractDialect } from '../dialect/abstractDialect.js';
import {
  AGGREGATE_VALUE_ALIAS,
  REL_NESTED_KEY,
  REL_FIELD_PREFIX,
  relTempField,
  SUM_COUNT_ALIAS,
  nullsSortField,
  sortAggregateField,
  TEXT_SCORE_ALIAS,
  NEAREST_DISTANCE_ALIAS,
} from '../dialect/aliases.js';
import {
  betweenBounds,
  inOperands,
  GROUP_OPS,
  groupClauses,
  isGroupOp,
  LIKE_OPS,
  likeRegex,
  whereOperators,
  sizeComparisons,
} from '../dialect/operators.js';
import {
  aggregateColumnField,
  groupPathField,
  type QueryJoin,
  type QueryJoins,
  resolveGroupJoins,
  relationSortTerms,
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
  FieldOptions,
  FieldUpdateOp,
  Query,
  QueryAggregate,
  QueryGroupOp,
  QueryOptions,
  QueryPager,
  QuerySelectValue,
  QuerySortMap,
  QueryTextSearchOptions,
  QueryVectorSearch,
  QueryWhere,
  QueryWhereArray,
  QueryWhereFieldOp,
  QueryWhereFieldOperatorMap,
  RelationKey,
  RelationMeta,
  RelationQuery,
  AbstractType,
} from '../type/index.js';
import { COUNT_RESULT_KEY } from '../type/query.js';
import { QuerySql } from '../type/querySql.js';
import {
  aggregateOf,
  isSelectList,
  assertAggregateColumns,
  assertNoUndefined,
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
  definedEntries,
  getKeys,
  holdsForeignKey,
  jsonPathKeys,
  getRelationRequestSummary,
  hasKeys,
  isFieldUpdateOp,
  isJsonObject,
  foldJson,
  type JsonArrayWrites,
  type JsonWrites,
  writesKeys,
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
  parseSortDirection,
  rankedTextSearch,
  someKey,
  targetJoins,
  textSortOf,
  indexedDistance,
  vectorDistanceOf,
  vectorCandidates,
  populatesRelations,
  cachedIn,
} from '../util/index.js';
import { UqlUsageError } from '../util/uqlError.js';
import { decodeBigIntsExcept } from '../util/wideNumber.js';
import { textLanguage } from './textLanguage.js';
import { vectorDistanceExpr } from './vectorDistance.js';

/**
 * Operators MongoDB already expresses natively. `Pick`'s constraint ties this back to
 * {@link QueryWhereFieldOperatorMap} so a rename there breaks this union at compile time.
 */
type MongoNativeOp = keyof Pick<
  QueryWhereFieldOperatorMap<unknown>,
  '$all' | '$size' | '$elemMatch' | '$eq' | '$ne' | '$lt' | '$lte' | '$gt' | '$gte' | '$in' | '$nin' | '$regex' | '$not'
>;

/**
 * An ordering as the pipeline runs it: the `$sort`, the fields it needs on the document first - a
 * placement's null flags - and the ones to take back off after it. One object, so a caller cannot
 * order by a field it forgot to add, or leave one behind in the rows it answers with.
 */
type MongoSortPlan = {
  readonly sort: Sort;
  readonly stages: MongoAggregationPipelineEntry<Document>[];
  readonly fields: string[];
};

/** How a read runs: its pipeline, or the ordering of the `find` cursor where one expresses it. */
export type MongoRead = { readonly pipeline: MongoAggregationPipelineEntry<Document>[] } | { readonly sort: Sort };

/** What a read pipeline contributes to {@link MongoDialect.readStages} beyond the query itself. */
type MongoReadStages = {
  /** Ordering, which runs after the lookups when it reads one of their fields. */
  readonly sort: MongoSortPlan;
  readonly pager?: MongoAggregationPipelineEntry<Document>[];
  /** The scores the read answers as fields, a vector search's or a text search's; a temporary one leaves again. */
  readonly scores: readonly MongoScore[];
};

/** A score as a field: `value` computes it, a `$meta` or an expression. */
type MongoScore = { readonly field: string; readonly value: Document; readonly temporary?: boolean };

/** A relation as `normalizeId` reads it: its key, the field a lookup put its rows on, and its entity. */
type RelationRead = { readonly key: string; readonly field: string; readonly meta: EntityMeta<object> };

/** The field a lookup puts a relation's rows on, prefixed so a stored field of the same name (a Mongoose `ref`) survives. */
function relationField(relKey: string): string {
  return `${REL_FIELD_PREFIX}${relKey}`;
}

/** Where a join's rows are on the queried document: its relation's field, under its parent's. */
function joinedPath(join: QueryJoin): string {
  return join.parent ? `${joinedPath(join.parent)}.${relationField(join.key)}` : relationField(join.key);
}

/** Lookup stages, and the temp fields they fill, which the pipeline takes back out once read. */
type Lookup = { stages: MongoAggregationPipelineEntry<Document>[]; temps: string[] };

const mergeLookups = (lookups: Lookup[]): Lookup => ({
  stages: lookups.flatMap((lookup) => lookup.stages),
  temps: lookups.flatMap((lookup) => lookup.temps),
});

const unsetOf = (temps: string[]): MongoAggregationPipelineEntry<Document>[] =>
  temps.length ? [{ $unset: temps }] : [];

/** A scalar field's operator as the aggregation operator computing it. */
const MONGO_ARITHMETIC = { $inc: '$add', $mul: '$multiply' } as const satisfies Record<keyof FieldUpdateOp, string>;

/**
 * One array's writes at `path`, as SQL writes them: the pulls, then each append onto `[]` in place of a
 * missing or null array, a `unique` one only where the array lacks its item; a value that is no array stays.
 */
function arrayWrite(path: string, { pulls, appends }: JsonArrayWrites): Document {
  const stored = `$${path}`;
  const kept = (array: Document | string) =>
    pulls.length > 0
      ? { $filter: { input: array, cond: { $not: [{ $in: ['$$this', { $literal: pulls }] }] } } }
      : array;
  if (appends.length === 0) {
    return { $cond: [{ $isArray: stored }, kept(stored), stored] };
  }
  const array = { $ifNull: [stored, []] };
  const addends = appends.map(({ item, unique }) => {
    const literal = [{ $literal: item }];
    return unique ? { $cond: [{ $in: [{ $literal: item }, array] }, [], literal] } : literal;
  });
  return { $cond: [{ $isArray: array }, { $concatArrays: [kept(array), ...addends] }, stored] };
}

/** The value at `path`: a `$literal` one as it is, or the object of its nested children, merged in. */
function assignedAt(path: string, node: Document): Document {
  return '$literal' in node ? node : mergedObject(path, node);
}

/** The object at `path` with `children` merged in: as SQL, a stored value that is no object counts as `{}`. */
function mergedObject(path: string, children: Document): Document {
  return {
    $mergeObjects: [
      { $cond: [{ $eq: [{ $type: `$${path}` }, 'object'] }, `$${path}`, {}] },
      Object.fromEntries(Object.entries(children).map(([key, child]) => [key, assignedAt(`${path}.${key}`, child)])),
    ],
  };
}

/**
 * A JSON column's one assignment: each path's write merged into its object, the nested `$set` paths under one
 * key merged into that key's. A column that is no object becomes one where a key is written, and else stays.
 */
function jsonAssignments(column: string, writes: JsonWrites): Document {
  // Prototype-free, so a key such as `__proto__` is a key of the document and not an object's prototype.
  const nested: Document = Object.create(null);
  for (const [key, item] of Object.entries(writes.set)) {
    const keys = jsonPathKeys(key);
    const parent = keys.slice(0, -1).reduce<Document>((node, part) => (node[part] ??= Object.create(null)), nested);
    parent[keys[keys.length - 1]] = { $literal: item };
  }
  const children = Object.fromEntries([
    ...Object.entries(nested).map(([key, node]) => [key, assignedAt(`${column}.${key}`, node)]),
    ...Object.entries(writes.arrays).map(([key, write]) => [key, arrayWrite(`${column}.${key}`, write)]),
  ]);
  if (!hasKeys(children)) {
    return {};
  }
  const isObject = { $eq: [{ $type: `$${column}` }, 'object'] };
  const otherwise = writesKeys(writes) ? children : `$${column}`;
  return { [column]: { $cond: [isObject, { $mergeObjects: [`$${column}`, children] }, otherwise] } };
}

/** Default {@link DialectFeatures} for MongoDB. */
export const mongoDialectFeatures: DialectFeatures = {
  indexIfNotExists: false,
  schemas: false, // the connection picks the database, and a collection name takes no dot
  dropTableCascade: false,
  rebuildsTables: false,
  vectorIndexRequiresNotNull: false,
  vectorSupportsLength: false,
  vectorBytes: false,
  supportsTimestamptz: false,
  stringSizing: 'boundedText',
  supportsUnsigned: false,
  serverSideCursors: false,
  correlatedWrites: false,
  rowLocks: false, // its concurrency control is the transaction plus atomic document updates
  writeReturning: false,
  nullsSortLowest: true,
};

/** What `toWireId` converts: the hex spelling of an `ObjectId`, and nothing looser. */
const HEX_24 = /^[0-9a-f]{24}$/i;

/** Where a statement can carry a `sql()`, as its refusal names it. */
type RawPlace = '$select' | '$where' | 'an aggregate $where' | 'a write';

/** `sql()` renders SQL, which MongoDB has no equivalent of: refused rather than emitted as `{}`. */
function rawRefusal(place: RawPlace): UqlUsageError {
  return new UqlUsageError(`sql() in ${place} is not supported on MongoDB`);
}

function assertNoRaw<T>(value: T, place: RawPlace): asserts value is Exclude<T, QuerySql> {
  if (value instanceof QuerySql) {
    throw rawRefusal(place);
  }
}

/** How a declared column type reads in a message: `Number`, `uuid` - not its whole source. */
function declaredTypeName(type: unknown): string {
  return typeof type === 'function' ? type.name : String(type);
}

const ID_KEY = '_id';

/** Native operators that compare a field against values. On a key field, those values are sent as `ObjectId`s. */
const KEY_OPERATORS: ReadonlySet<string> = new Set([
  '$eq',
  '$ne',
  '$lt',
  '$lte',
  '$gt',
  '$gte',
  '$in',
  '$nin',
] satisfies MongoNativeOp[]);
/** Atlas rejects a `$vectorSearch` asking for more candidates than this. */
const MAX_NUM_CANDIDATES = 10_000;

/** Adds `expr` to `filter`'s `$expr`, `AND`ed with any already there. */
function andExpr(filter: Record<string, unknown>, expr: Record<string, unknown>): void {
  filter['$expr'] = filter['$expr'] ? { $and: [filter['$expr'], expr] } : expr;
}

/**
 * `value` as an expression reads it, verbatim: bare, a string could name a field (`'$name'`), an object
 * an operator, and an array its elements' expressions. A number reads as itself.
 */
function literal(value: unknown): unknown {
  return typeof value === 'number' ? value : { $literal: value };
}

/** Every term true: the term itself when it is the only one. */
function allOf<T>(terms: T[]): T | { $and: T[] } {
  return terms.length === 1 ? terms[0] : { $and: terms };
}

/**
 * The array at `ref` has `size` elements, or a count in its bounds: an expression, since MongoDB's own
 * `$size` takes only a number. No other value has a size, and `$and` may evaluate every operand, so the
 * count reads an empty array in place of one.
 */
function arraySize(ref: string, size: unknown): Record<string, unknown> {
  const count = { $size: { $cond: [{ $isArray: ref }, ref, []] } };
  return { $and: [{ $isArray: ref }, compareCount(count, size)] };
}

/** `count` compared with `size`, a number or its bounds, as an aggregation expression. */
function compareCount(count: unknown, size: unknown): Record<string, unknown> {
  const comparisons = sizeComparisons(size).flatMap(([op, bound]): Record<string, unknown>[] => {
    if (op !== '$between') {
      return [{ [op]: [count, literal(bound)] }];
    }
    const [min, max] = betweenBounds(bound);
    return [{ $gte: [count, literal(min)] }, { $lte: [count, literal(max)] }];
  });
  return allOf(comparisons);
}

/** Whether the array at `ref` has an element `test` passes, reading it as `$$this`. No other value has one. */
function anyElement(ref: string, test: unknown): Record<string, unknown> {
  return { $cond: [{ $isArray: ref }, { $anyElementTrue: [{ $map: { input: ref, in: test } }] }, false] };
}

/**
 * Whether `ref` holds a value of `operand`'s type, the only one a query's ordering compares it with: an
 * expression orders across types, every string above a number and a null below it.
 */
function sameType(ref: string, operand: unknown): Record<string, unknown> {
  return typeof operand === 'number' || typeof operand === 'bigint'
    ? { $isNumber: ref }
    : { $eq: [{ $type: ref }, { $type: literal(operand) }] };
}

/** Whether the string at `ref` matches `regex`. Any other value matches none, where `$regexMatch` would fail. */
function regexMatch(ref: string, regex: string, insensitive = false): Record<string, unknown> {
  const match = { $regexMatch: { input: ref, regex: literal(regex), ...(insensitive && { options: 'i' }) } };
  return { $cond: [{ $eq: [{ $type: ref }, 'string'] }, match, false] };
}

/** Atlas filters only before it ranks, by fields its index holds, never by a distance. */
function nearRefusal(): UqlUsageError {
  return new UqlUsageError(
    '$near is not supported on MongoDB: Atlas cannot filter by distance. ' +
      "Project the distance with $sort's $project and filter on it instead.",
  );
}

/** `$text` runs only as a pipeline's first stage, which a relation's, inside its `$lookup`, never is. */
function assertNoRelationText(path: string, query: Query<object>): void {
  if (query.$where?.$text !== undefined || query.$sort?.$text !== undefined) {
    throw new UqlUsageError(`cannot $text search relation '${path}' on MongoDB: $text runs only on the queried entity`);
  }
}

/** MongoDB native operators - pass through as-is. */
const NATIVE_OPS: ReadonlySet<QueryWhereFieldOp> = new Set<MongoNativeOp>([
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

/** `1` where `ref` holds a value, `0` where it is null or missing, which an expression tells apart. */
function countOf(ref: string): Record<string, unknown> {
  return { $cond: [isNullExpr(ref), 0, 1] };
}

/** Whether `ref` is null or missing: an expression compares a missing field as neither. */
function isNullExpr(ref: string): Record<string, unknown> {
  return { $eq: [{ $ifNull: [ref, null] }, null] };
}

export class MongoDialect extends AbstractDialect {
  override readonly features: DialectFeatures = mongoDialectFeatures;

  readonly dialectName = 'mongodb';

  /**
   * MongoDB stores the primary key as `_id`; everything else resolves as usual. Projections, sorts,
   * `$group` refs and `$where` keys all map through here, so no read path can address a property name
   * the document does not use.
   */
  override columnOf<E>(meta: EntityMeta<E>, key: string): string {
    if (key === ID_KEY) {
      return ID_KEY;
    }
    if (meta.fields[key]?.isId) {
      // A document has one `_id`. A composite key is a different document shape - a sub-document,
      // whose field order decides equality - rather than a translation, so it is refused here, which
      // every read reaches, and in `getPersistables`, which every write reaches.
      assertSoleId(meta, 'MongoDB');
      return ID_KEY;
    }
    return super.columnOf(meta, key);
  }

  public where<E extends Document>(
    entity: AbstractType<E>,
    where: QueryWhere<E> = {},
    opts: QueryOptions = {},
  ): Filter<E> {
    const meta = getMeta(entity);
    // Filters are applied once, here at the scope entry point; recursion uses `renderFilter`.
    return this.renderFilter(entity, this.scopedWhere(meta, where, opts));
  }

  /**
   * The stages every pipeline starts with: the `$lookup` each relation condition needs, into a temporary
   * field so `$or` keeps its meaning, the `$match` reading them, and the temporaries taken back out. Each
   * relation aggregate the `$where` or `fields` reads is left on the document, once, under its column.
   * `lookup` keeps the temporaries used, so a later lookup neither repeats nor reuses one.
   */
  public matchStages<E extends Document>(
    entity: AbstractType<E>,
    where: QueryWhere<E> = {},
    opts: QueryOptions = {},
    fields: readonly string[] = [],
    lookup: Lookup = { stages: [], temps: [] },
  ): MongoAggregationPipelineEntry<Document>[] {
    const meta = getMeta(entity);
    for (const key of fields) {
      this.appendAggregateField(meta, key, lookup);
    }
    const filter = this.renderFilter(entity, this.scopedWhere(meta, where, opts), lookup);
    return [...lookup.stages, ...(hasKeys(filter) ? [{ $match: filter }] : []), ...unsetOf(lookup.temps)];
  }

  /**
   * Renders a `$where` tree without applying entity filters (used for same-scope group-operator
   * recursion). A relation, or a relation aggregate, needs `$lookup` stages, so it is only accepted
   * when `lookup` is given - a plain `find`/`updateMany` filter has nowhere to put them.
   */
  protected renderFilter<E extends Document>(
    entity: AbstractType<E>,
    where: QueryWhere<E> = {},
    lookup?: Lookup,
  ): Filter<E> {
    const meta = getMeta(entity);
    const filter: Record<string, unknown> = {};
    for (const [rawKey, rawVal] of Object.entries(where)) {
      let key = rawKey;
      let val: unknown = rawVal;
      if (isGroupOp(key)) {
        this.appendLogicalOperator(filter, entity, key, val as QueryWhereArray<E>, lookup);
      } else if (key === '$text') {
        // MongoDB's text index declares which fields it covers, so `$fields` cannot narrow the search
        // the way it does elsewhere - the same shape as `$distance` being index-defined here.
        const { $value, $config } = val as QueryTextSearchOptions<E>;
        filter['$text'] = { $search: $value, ...($config && { $language: textLanguage($config) }) };
      } else if (meta.relations[key]) {
        assertNoRaw(val, '$where');
        if (!lookup) {
          throw new UqlUsageError(`filtering by relation '${key}' is not supported here on MongoDB`);
        }
        andExpr(filter, this.relationExpression(meta, key, val, lookup));
      } else {
        assertNoRaw(val, '$where');
        this.assertKnownPathRoot(meta, key);
        if (aggregateOf(meta.fields[key])) {
          if (!lookup) {
            throw new UqlUsageError(`filtering by relation aggregate '${key}' is not supported here on MongoDB`);
          }
          this.appendAggregateField(meta, key, lookup);
        }
        const keyed = this.holdsKeys(meta, key);
        key = this.pathOf(meta, key);
        if (!isOperatorObject(val)) {
          const wire = keyed ? this.toWireId(val) : val;
          filter[key] = Array.isArray(wire) ? { $in: wire } : wire;
          continue;
        }
        const operators = (ops: Record<string, unknown>) => {
          const native = this.transformOperators(ops);
          return keyed ? this.toWireOperands(native) : native;
        };
        // MongoDB's `$size` takes only a number, so bounds become an `$expr` beside the other operators.
        const { $size: size, ...ops } = val;
        if (!isRecord(size)) {
          filter[key] = operators(val);
        } else {
          andExpr(filter, arraySize(`$${key}`, size));
          if (hasKeys(ops)) {
            filter[key] = operators(ops);
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
    entity: AbstractType<E>,
    key: QueryGroupOp,
    val: QueryWhereArray<E>,
    lookup?: Lookup,
  ): void {
    const { join, negate } = GROUP_OPS[key];
    const parts = groupClauses(key, val)
      .map((filterIt) => {
        assertNoRaw(filterIt, '$where');
        return this.renderFilter(entity, filterIt, lookup);
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
   * One relation condition as an expression over the correlated `$lookup` it adds to `lookup`: a row exists
   * for a plain filter, the row count compared for a `$size`. The target's (and, for ManyToMany, the
   * junction's) own filters scope the lookup, so a relation subquery can no more read out-of-scope rows
   * than a direct query on the target can.
   */
  private relationExpression<E>(
    meta: EntityMeta<E>,
    relKey: string,
    val: unknown,
    lookup: Lookup,
  ): Record<string, unknown> {
    const sizeVal = parseRelationSize(val);
    const temp = relTempField('cond', lookup.temps.length);
    const tail = sizeVal === undefined ? [{ $limit: 1 }] : [{ $count: AGGREGATE_VALUE_ALIAS }];
    const where = (sizeVal === undefined ? val : {}) as QueryWhere<object>;
    lookup.temps.push(temp);
    lookup.stages.push(this.relationLookup(meta, meta.relations[relKey]!, where, temp, tail));
    return sizeVal === undefined ? { $gt: [{ $size: `$${temp}` }, 0] } : compareCount(this.tally(temp), sizeVal);
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
        foreignField: ID_KEY,
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
    through: AbstractType<Document>,
  ) {
    const throughMeta = getMeta(through);
    assertSoleId(meta, 'MongoDB');
    assertSoleId(relMeta, 'MongoDB');
    const [parentJoin] = parentJoins(relOpts, meta.ids.length);
    const [{ column: targetColumn }] = targetJoins(relOpts, meta.ids.length);
    const scope = this.renderFilter(through, this.scopedWhere(throughMeta, {}));
    return {
      lookup: {
        from: this.resolveTableName(throughMeta),
        localField: ID_KEY,
        foreignField: this.columnOf(throughMeta, parentJoin.column),
      },
      scope: hasKeys(scope) ? [{ $match: scope }] : [],
      target: this.columnOf(throughMeta, targetColumn),
    };
  }

  /**
   * A dotted key addresses an embedded path, whose root must still be a declared field - otherwise it
   * is a typo (or an injected key) that would silently match nothing, the same guard the SQL dialects
   * apply to JSON paths.
   */
  private assertKnownPathRoot<E>(meta: EntityMeta<E>, key: string): void {
    const root = key.includes('.') ? key.slice(0, key.indexOf('.')) : key;
    if (root === ID_KEY || meta.fields[root]) {
      return;
    }
    throw new UqlUsageError(`path ${key} does not exist in ${entityName(meta)}`);
  }

  /** Transform UQL operators to MongoDB operators, refusing as `refusal` a key that is none. */
  private transformOperators(ops: unknown, refusal = 'unknown operator'): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [op, val] of whereOperators(ops, refusal)) {
      // `$elemMatch`'s value is itself a condition, so the operators inside it need the same
      // mapping - passing it through raw sends UQL-only operators (`$startsWith`, `$between`, ...)
      // straight to the server, which rejects them as unknown.
      if (op === '$elemMatch') {
        result[op] = this.held(val);
        continue;
      }
      // `$not` wraps a condition too: a value or a list as the operator it means, which native `$not` refuses,
      // and a uql-only operator inside it (`$isNull`, `$startsWith`) mapped.
      if (op === '$not') {
        result[op] = this.transformOperators(val, refusal);
        continue;
      }
      // An object or an array is matched by what it holds, as the SQL engines read it, where native `$all`
      // compares the whole element. MongoDB takes `$elemMatch` there only when every value is one.
      if (op === '$all' && Array.isArray(val) && val.some((value) => Array.isArray(value) || isOperatorMap(value))) {
        result[op] = this.allHolding(val);
        continue;
      }
      // Native MongoDB operators - pass through directly
      if (NATIVE_OPS.has(op)) {
        result[op] = val;
        continue;
      }
      // The `$like` family, as the regex matching what its `LIKE` pattern matches on SQL.
      const like = LIKE_OPS.get(op);
      if (like) {
        result['$regex'] = likeRegex(like.pattern(String(val)));
        if (like.insensitive) result['$options'] = 'i';
        continue;
      }
      // Structural transforms
      switch (op) {
        case '$between': {
          const [min, max] = betweenBounds(val);
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
          throw nearRefusal();
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

  public select<E extends Document>(entity: AbstractType<E>, select?: QuerySelectValue<E>): Record<string, 0 | 1> {
    const meta = getMeta(entity);
    if (!select) {
      return {};
    }
    if (isSelectList(select)) {
      throw rawRefusal('$select');
    }
    const fields = normalizeScalarFieldSelection(meta, select);
    // Projected by column, not by field key; `normalizeId` maps them back on the way out.
    const projection = fields.reduce<Record<string, 0 | 1>>((acc, key) => {
      // A computed field that writes SQL has nothing in the document to project: refused when `$select`
      // names it, skipped otherwise. A relation aggregate is already on the document, like any column.
      const field = meta.fields[key];
      if (field?.computed && !aggregateOf(field)) {
        if (select && key in select) {
          assertReadable(meta, key);
        }
        return acc;
      }
      acc[this.columnOf(meta, key)] = 1;
      return acc;
    }, {});
    // MongoDB returns `_id` unless it is explicitly excluded, so a projection without the key sets `_id: 0`,
    // the one inclusion/exclusion mix MongoDB allows. This returns the same fields a SQL engine would, and is
    // what makes `$select: { id: false }` work at all.
    if (!fields.includes(soleIdOf(meta, 'MongoDB'))) {
      projection[ID_KEY] = 0;
    }
    return projection;
  }

  /**
   * The `$sort` stage. A relation key reads the document a `$lookup` unwound onto the parent, so - as
   * on the SQL dialects - it is only addressable when the statement joins that relation. Here that
   * means a *populated* one, at every level of the path: a lookup adds a field to the result, so one
   * added for the sort alone would change what the caller gets back.
   */
  private sort<E extends Document>(entity: AbstractType<E>, q: Query<E>): Sort {
    return this.sortPlan(entity, q).sort;
  }

  /**
   * The ordering, and the paths whose nulls it places. MongoDB sorts null and missing lowest and takes
   * no placement, so one is emulated: {@link nullsSortStages} flags each path and the flag is ordered
   * by ahead of the value itself. `ranked` is a field holding a vector distance, ordered by first.
   */
  private sortPlan<E extends Document>(
    entity: AbstractType<E>,
    { $sort: sort, $populate: populate, $where: where }: Query<E>,
    ranked?: string,
  ): MongoSortPlan {
    const meta = getMeta(entity);
    const nearest: Record<string, 1> = ranked ? { [ranked]: 1 } : {};
    const columns: Record<string, 1 | -1> = {};
    const placed: string[] = [];
    // Refused as the SQL dialects refuse it, before MongoDB answers a missing score with its own error.
    if (sort?.$text) {
      rankedTextSearch(where);
    }
    // The same join set the lookups are built from, so what an ordering may address and what the
    // pipeline actually produces cannot drift apart - `$sort` contributes its own to-one joins here
    // exactly as it does on the SQL dialects.
    const joins = resolveQueryJoins(meta, { $populate: populate, $sort: sort });
    this.collectSort(meta, sort, joins, { path: '' }, nearest, columns, placed);
    const flags = Object.fromEntries(
      placed.map((path) => [nullsSortField(path), { $cond: [{ $eq: [{ $ifNull: [`$${path}`, null] }, null] }, 1, 0] }]),
    );
    return {
      // A vector distance is the primary ordering wherever it appears, as on the SQL dialects.
      sort: { ...nearest, ...columns },
      stages: placed.length ? [{ $addFields: flags }] : [],
      fields: placed.map(nullsSortField),
    };
  }

  /**
   * Walks `$sort` against the metadata of the entity each level addresses, as the SQL dialects do. `at` is where the
   * level is: the relations walked to it (`path`, ending in a dot), and the join its rows came from, if any.
   */
  private collectSort<E>(
    meta: EntityMeta<E>,
    sort: QuerySortMap<E> | undefined,
    joins: QueryJoins,
    at: { readonly path: string; readonly join?: QueryJoin },
    nearest: Record<string, 1>,
    out: Record<string, 1 | -1>,
    placed: string[],
  ): void {
    for (const [key, value] of Object.entries(sort ?? {})) {
      const relation = meta.relations[key];
      if (key === '$text') {
        if (at.path) {
          throw new UqlUsageError(
            `$sort by $text is only supported on the queried entity, not on relation '${at.path.slice(0, -1)}'`,
          );
        }
        const { order, project } = textSortOf(sort)!;
        out[project ?? TEXT_SCORE_ALIAS] = sortDirection(order);
        continue;
      }
      if (!relation) {
        // The queried entity's first vector search is lifted out into `$vectorSearch` before this walk,
        // so one found here is a second one. It is refused as such, not as an unknown direction.
        if (isVectorSearch(value)) {
          throw new UqlUsageError(`cannot $sort by a second vector '${key}' on MongoDB: $vectorSearch ranks by one`);
        }
        const field = (at.join ? `${joinedPath(at.join)}.` : '') + this.pathOf(meta, key);
        const { desc, nulls } = parseSortDirection(value);
        if (nulls) {
          placed.push(field);
          // The flag holds 1 for a null, so ordering by it descending brings the null block to the front.
          out[nullsSortField(field)] = nulls === 'first' ? -1 : 1;
        }
        out[field] = desc ? -1 : 1;
        continue;
      }
      // A `$lookup` is what puts the relation's fields on the document, and only `$populate` asks for
      // one: ordering by a relation nothing looked up reads a field that is not there, which MongoDB
      // ranks as all-equal rather than rejecting. The SQL dialects can add the join themselves.
      const relPath = `${at.path}${key}`;
      const { aggregates, rest } = relationSortTerms(key, relPath, value);
      for (const { spec, direction } of aggregates) {
        // The value rides on a field {@link sortAggregateStages} adds, which only the queried entity's
        // own pipeline has: a nested one is built inside its parent's `$lookup`, where there is no
        // parent document left to hang it off.
        if (at.path) {
          throw new UqlUsageError(
            `$sort by '${relPath}.${spec.field ?? '$count'}' is only supported on the queried entity`,
          );
        }
        if (spec.search) {
          nearest[sortAggregateField(spec)] = 1;
        } else {
          out[sortAggregateField(spec)] = sortDirection(direction);
        }
      }
      if (rest === undefined) {
        continue;
      }
      const { join, sort: relationSort } = resolveSortableJoin(
        relation,
        relPath,
        rest,
        joins,
        `cannot $sort by relation '${relPath}' on MongoDB unless it is populated: only $populate adds its fields to the document`,
      );
      this.collectSort(join.meta, relationSort, joins, { path: `${relPath}.`, join }, nearest, out, placed);
    }
  }

  /**
   * The stages a `$sort` by a relation's aggregate needs - its size, or its row nearest a vector: one
   * correlated `$lookup` reading it per parent, and the `$set` that lifts it onto the document as the
   * field the `$sort` then orders by. A parent with no related row reads a zero tally and no distance.
   */
  public sortAggregateStages<E extends Document>(
    entity: AbstractType<E>,
    sort: QuerySortMap<E> | undefined,
  ): Lookup & { readonly fields: string[] } {
    const meta = getMeta(entity);
    const specs = Object.entries(sort ?? {}).flatMap(([key, value]) =>
      meta.relations[key] ? relationSortTerms(key, key, value).aggregates.map(({ spec }) => spec) : [],
    );
    const fields = specs.map(sortAggregateField);
    const lookups = specs.map((spec, index) =>
      this.aggregateStages(meta, spec, relTempField('sort', fields[index]), fields[index]),
    );
    return { ...mergeLookups(lookups), fields };
  }

  /** The relation aggregates a read projects or sorts by; its `$where` puts its own on the document. */
  private aggregateKeys<E extends Document>(entity: AbstractType<E>, q: Query<E>): string[] {
    const meta = getMeta(entity);
    const projected = normalizeScalarFieldSelection(meta, isSelectList(q.$select) ? undefined : q.$select);
    return [...projected, ...Object.keys(q.$sort ?? {})].filter((key) => aggregateOf(meta.fields[key]));
  }

  /**
   * The relation aggregate `key` computes, put on the document under its column by the stages
   * {@link aggregateStages} builds from the same spec SQL renders as a subquery. Once however many
   * clauses read it; a key computing none adds nothing.
   */
  private appendAggregateField<E>(meta: EntityMeta<E>, key: string, lookup: Lookup): void {
    const spec = aggregateOf(meta.fields[key]);
    const temp = relTempField('field', key);
    if (!spec || lookup.temps.includes(temp)) {
      return;
    }
    const { stages, temps } = this.aggregateStages(meta, spec, temp, this.columnOf(meta, key));
    lookup.stages.push(...stages);
    lookup.temps.push(...temps);
  }

  /**
   * One relation aggregate on the document under `field`: the correlated lookup that reads the related
   * rows - narrowed, ordered and capped as the spec says - ending in the tally or total it wants, and
   * the `$addFields` reading that back, `0` or `null` where the lookup matched nothing.
   *
   * Every aggregate MongoDB answers is built here: a `$count` a query asks for, an ordering by one, and
   * a field a `computed` declares, which is the same spec the SQL dialects render as one subquery.
   */
  private aggregateStages<E>(meta: EntityMeta<E>, spec: RelationAggregateSpec, temp: string, field: string): Lookup {
    const relOpts = relationOf(meta, spec.relation as RelationKey<E>);
    const relMeta = getMeta(relOpts.entity());
    const page = spec.page ?? {};
    // A many-to-many's lookup runs over its junction's rows, each carrying its target: read as that
    // target, so the page's order and the aggregate reach the target's own fields.
    const targets = relOpts.through ? [{ $replaceRoot: { newRoot: { $arrayElemAt: [`$${REL_NESTED_KEY}`, 0] } } }] : [];
    const tail = [
      ...targets,
      ...(page.$sort ? [{ $sort: this.sort(relOpts.entity(), page) }] : []),
      ...this.pagerStages(page),
      spec.field
        ? {
            $group: {
              _id: null,
              [AGGREGATE_VALUE_ALIAS]: {
                [spec.op]: spec.search
                  ? vectorDistanceExpr(
                      this.columnOf(relMeta, spec.field),
                      spec.search.$vector,
                      vectorDistanceOf(relMeta, spec.field, spec.search),
                    )
                  : `$${this.columnOf(relMeta, spec.field)}`,
              },
            },
          }
        : { $count: AGGREGATE_VALUE_ALIAS },
    ];
    return {
      stages: [
        this.relationLookup(meta, relOpts, spec.where ?? {}, temp, tail),
        { $addFields: { [field]: this.tally(temp, spec.op) } },
      ],
      temps: [temp],
    };
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
    entity: AbstractType<E>,
    q: Query<E>,
  ): MongoAggregationPipelineEntry<Document>[] {
    const meta = getMeta(entity);
    const toMany = getRelationRequestSummary(meta, q.$populate).toManyKeys.map((relKey) =>
      this.toManyLookup(meta, relKey, parseRelationAtKey(relKey, q.$populate).query),
    );
    const counts = countedRelations(meta, q.$count).map(({ relKey, where }): Lookup => {
      const temp = relTempField('count', relKey);
      const spec: RelationAggregateSpec = { relation: relKey, op: '$count', where };
      return this.aggregateStages(meta, spec, temp, `${COUNT_RESULT_KEY}.${relKey}`);
    });
    const { stages, temps } = mergeLookups([...toMany, ...counts]);
    return [...stages, ...unsetOf(temps)];
  }

  /**
   * A to-many's rows as a lookup running their own read, whose filters, ordering and page apply per
   * parent inside it. A many-to-many reads its targets, each once, by the ids its junction pairs the
   * parent with, parked in a temporary field of the parent's.
   */
  private toManyLookup<E>(meta: EntityMeta<E>, relKey: RelationKey<E>, query: RelationQuery): Lookup {
    const relOpts = relationOf(meta, relKey);
    const relEntity = relOpts.entity();
    const relMeta = getMeta(relEntity);
    assertNoRelationText(relKey, query);
    const read = this.aggregationPipeline(relEntity, query);
    const pipeline = read.length ? { pipeline: read } : {};
    const from = this.resolveTableName(relMeta);
    if (!relOpts.through) {
      return {
        stages: [
          { $lookup: { from, ...this.joinKeys(meta, relMeta, relOpts), ...pipeline, as: relationField(relKey) } },
        ],
        temps: [],
      };
    }
    const junction = this.junctionOf(meta, relOpts, relMeta, relOpts.through());
    const temp = relTempField('rel', relKey);
    return {
      temps: [temp],
      stages: [
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
            foreignField: ID_KEY,
            ...pipeline,
            as: relationField(relKey),
          },
        },
      ],
    };
  }

  /** Whether a `$sort` reads a relation, which is what forces the lookups to run before it. */
  public sortsRelations<E extends Document>(entity: AbstractType<E>, sort: QuerySortMap<E> | undefined): boolean {
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
    return `${this.columnOf(meta, key.slice(0, dot))}.${jsonPathKeys(key.slice(dot + 1)).join('.')}`;
  }

  /**
   * How a read runs, its ordering and aggregates read once for both the routing and the run: the one place
   * deciding how a read is scored and ranked, a root vector search through Atlas.
   */
  public readPlan<E extends Document>(entity: AbstractType<E>, q: Query<E>, opts?: QueryOptions): MongoRead {
    const vector = this.extractVectorSort(q.$sort);
    if (vector) {
      return { pipeline: this.vectorSearchPipeline(entity, q, vector, opts) };
    }
    const sort = this.sortPlan(entity, q);
    const aggregates = this.aggregateKeys(entity, q);
    return this.readsThroughPipeline(entity, q, sort, aggregates)
      ? { pipeline: this.scanPipeline(entity, q, opts, sort, aggregates, []) }
      : { sort: sort.sort };
  }

  /**
   * Whether a read needs stages a `find` cursor cannot express: a lookup to populate, count, filter or
   * order by a relation, one to build a relation aggregate, and the grouping `$distinct` is.
   */
  private readsThroughPipeline<E extends Document>(
    entity: AbstractType<E>,
    q: Query<E>,
    sort: MongoSortPlan,
    aggregates: readonly string[],
  ): boolean {
    return (
      !!q.$distinct ||
      hasKeys(q.$count) ||
      populatesRelations(getMeta(entity), q.$populate) ||
      this.constrainsRelations(entity, q.$where) ||
      this.sortsRelations(entity, q.$sort) ||
      aggregates.length > 0 ||
      // A placement is a field the pipeline adds and orders by; a `find` cursor can add none.
      hasKeys(sort.fields) ||
      textSortOf(q.$sort) !== undefined
    );
  }

  /**
   * Build an aggregation pipeline for vector similarity search.
   * `$vectorSearch` is always the first stage; `$where` is merged into its `filter`.
   */
  private vectorSearchPipeline<E extends Document>(
    entity: AbstractType<E>,
    q: Query<E>,
    vectorSort: ExtractedVectorSort<E>,
    opts?: QueryOptions,
  ): MongoAggregationPipelineEntry<Document>[] {
    // Atlas ranks the rows already, so the exact distance is computed only where something reads it: its
    // `$project`, or the other keys, which only break its ties.
    const tied = hasKeys(vectorSort.regularSort);
    const nearest = (vectorSort.vectorSearch.$project !== undefined || tied) && this.nearestScore(entity, vectorSort);
    return [
      this.buildVectorSearchStage(
        entity,
        vectorSort.vectorKey,
        vectorSort.vectorSearch,
        q.$where,
        q.$limit ?? 10,
        opts,
        vectorCandidates(q),
      ),
      // `$vectorSearch` has already applied `$limit`, so the pager is its own.
      ...this.readStages(entity, q, {
        sort: this.sortPlan(
          entity,
          { ...q, $sort: vectorSort.regularSort },
          nearest && tied ? nearest.field : undefined,
        ),
        scores: nearest ? [nearest] : [],
      }),
    ];
  }

  /** A read as a pipeline, whether or not a `find` cursor would express it. */
  public aggregationPipeline<E extends Document>(
    entity: AbstractType<E>,
    q: Query<E>,
    opts?: QueryOptions,
  ): MongoAggregationPipelineEntry<Document>[] {
    // A vector search here is one no `$vectorSearch` lifted, a relation's inside its lookup, which Atlas cannot reach.
    const vector = this.extractVectorSort(q.$sort);
    const nearest = vector && this.nearestScore(entity, vector);
    const sort = this.sortPlan(entity, vector ? { ...q, $sort: vector.regularSort } : q, nearest?.field);
    return this.scanPipeline(entity, q, opts, sort, this.aggregateKeys(entity, q), nearest ? [nearest] : []);
  }

  /** The pipeline of a read no `$vectorSearch` enters, given its ordering, aggregates and vector score. */
  private scanPipeline<E extends Document>(
    entity: AbstractType<E>,
    q: Query<E>,
    opts: QueryOptions | undefined,
    sort: MongoSortPlan,
    aggregates: readonly string[],
    nearest: readonly MongoScore[],
  ): MongoAggregationPipelineEntry<Document>[] {
    // Sorted as a field, which goes either way where a `$meta` sort only descends.
    const text = textSortOf(q.$sort);
    const scores = [
      ...nearest,
      ...(text
        ? [{ field: text.project ?? TEXT_SCORE_ALIAS, value: { $meta: 'textScore' }, temporary: !text.project }]
        : []),
    ];
    return [
      ...this.matchStages(entity, q.$where, opts, aggregates),
      ...this.readStages(entity, q, { sort, pager: this.pagerStages(q), scores }),
    ];
  }

  /** A vector search's exact distance, by its metric, as a score to rank by: its `$project`, else a temporary field. */
  private nearestScore<E extends Document>(entity: AbstractType<E>, vector: ExtractedVectorSort<E>): MongoScore {
    const { vectorKey, vectorSearch } = vector;
    const meta = getMeta(entity);
    const metric = vectorDistanceOf(meta, vectorKey, vectorSearch);
    const value = vectorDistanceExpr(this.columnOf(meta, vectorKey), vectorSearch.$vector, metric);
    const field = vectorSearch.$project ?? NEAREST_DISTANCE_ALIAS;
    return { field, value, temporary: vectorSearch.$project === undefined };
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
  private readStages<E extends Document>(
    entity: AbstractType<E>,
    q: Query<E>,
    extra: MongoReadStages,
  ): MongoAggregationPipelineEntry<Document>[] {
    const meta = getMeta(entity);
    const joins = resolveQueryJoins(meta, q);
    // The value an ordering by a relation's aggregate reads, and the field it parks it on: both belong
    // with the lookups, since the `$sort` right after them is what they exist for.
    const aggregated = this.sortAggregateStages(entity, q.$sort);
    const ordering = extra.sort;
    const lookups = [...this.lookupStages(meta, joins), ...aggregated.stages];
    // Each to-many and each `$count`, which neither drop nor reorder a row, so they read the page alone.
    const related = this.relationReadStages(entity, q);
    // The flags a placement orders by travel with their `$sort`, wherever the pipeline puts it.
    const sort = hasKeys(ordering.sort) ? [...ordering.stages, { $sort: ordering.sort }] : [];
    const pager = extra.pager ?? [];

    // The score becomes a real field before anything reads it, so the lookups, the sort and the projection
    // that follow treat it like any other; merged into the query's own projection rather than standing in
    // for one, since a query that asked for no columns wants the whole document as well.
    const { scores } = extra;
    for (const score of scores) {
      if (!score.temporary) {
        this.assertProjectable(meta, score.field);
      }
    }
    const scored = scores.length
      ? [{ $addFields: Object.fromEntries(scores.map((score) => [score.field, score.value])) }]
      : [];
    const unscored = unsetOf(scores.filter((score) => score.temporary).map((score) => score.field));
    const projection = this.pipelineProjection(entity, q);
    const projected =
      projection && scores.length
        ? { ...projection, ...Object.fromEntries(scores.map((score) => [score.field, 1 as const])) }
        : projection;
    const project = projected ? [{ $project: projected }] : [];

    // A `$lookup` the ordering asked for puts a field on the document the caller never requested,
    // which is the one way this differs from a SQL join. Taken back out once the `$sort` that needed
    // it has run, so ordering by an unpopulated relation costs the same nothing it does there.
    const sortOnly = [...joins.values()].filter((join) => !join.projected);
    const dropped = [
      ...sortOnly.map((join) => joinedPath(join)),
      ...aggregated.temps,
      ...aggregated.fields,
      ...ordering.fields,
    ];
    const unset = unsetOf(dropped);

    // The grouping collapses rows onto the columns it projects, which leaves nothing for an ordering
    // that reads a lookup those columns do not carry. Refused rather than answered all-equal, and in
    // the same terms the SQL dialects refuse `SELECT DISTINCT` ordered by an unselected column.
    if (q.$distinct && aggregated.fields.length) {
      throw new UqlUsageError(
        `cannot $sort by a relation's aggregate with $distinct: the grouping keeps only the columns it projects`,
      );
    }
    if (q.$distinct && scores.some((score) => score.temporary)) {
      throw new UqlUsageError(
        'cannot $sort by a vector distance or text score with $distinct unless it is projected: the grouping keeps only the columns it projects',
      );
    }
    if (q.$distinct && sortOnly.length) {
      throw new UqlUsageError(
        `cannot $sort by relation '${sortOnly[0].path}' with $distinct unless '${sortOnly[0].path}' is populated: the grouping keeps only the columns it projects`,
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
  public pipelineProjection<E extends Document>(
    entity: AbstractType<E>,
    q: Query<E>,
  ): Record<string, 0 | 1> | undefined {
    if (!q.$select) {
      return undefined;
    }
    const projection = this.select(entity, q.$select);
    const meta = getMeta(entity);
    for (const relKey of getRelationRequestSummary(meta, q.$populate).requestedKeys) {
      projection[relationField(relKey)] = 1;
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
      assertNoRelationText(join.path, join.query);
      const relationFilter = this.where(join.entity, join.query.$where ?? {});
      // The relation's own projection runs inside the lookup, where its keys resolve against the
      // related entity. Left out, `$populate: { rel: { $select } }` returned all of `rel`'s columns.
      const relationProjection = this.pipelineProjection(join.entity, join.query);
      // MongoDB returns `_id` unless a projection subtracts it, so dropping the key from the map is
      // how a joined document keeps its own id, as it does on the SQL dialects.
      delete relationProjection?.[ID_KEY];

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
          as: relationField(join.key),
        },
      });

      // `$required` drops parents with no match, the aggregation equivalent of an INNER JOIN.
      pipeline.push({
        $unwind: { path: `$${relationField(join.key)}`, preserveNullAndEmptyArrays: !join.required },
      });
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
    if (holdsForeignKey(relOpts)) {
      // The target's side, not this entity's: a lookup matches one `localField` against one
      // `foreignField`, so a composite target would join on its first column alone and gather the
      // rows of every key that agrees on it. The other branch is refused by `columnOf` below, whose
      // key *is* an id column; this one names a plain foreign key, so it has to say so itself.
      assertSoleId(relMeta, 'MongoDB');
      return { localField: this.columnOf(meta, relOpts.references[0].local), foreignField: ID_KEY };
    }
    return { localField: ID_KEY, foreignField: this.columnOf(relMeta, relOpts.references[0].foreign) };
  }

  /** `[column, key]` for the fields whose stored name differs from their property name, memoized per entity. */
  private renamedColumns<E>(meta: EntityMeta<E>): readonly [string, string][] {
    return cachedIn(this.#renamedColumns, meta, () =>
      getKeys(meta.fields)
        .map((key): [string, string] => [this.columnOf(meta, key), key])
        .filter(([column, key]) => column !== key),
    );
  }

  /** Each relation's key, the field its rows are read from, and its entity, memoized per entity for `normalizeId`. */
  private relationReads<E>(meta: EntityMeta<E>): readonly RelationRead[] {
    return cachedIn(this.#relationReads, meta, () =>
      definedEntries(meta.relations).map(([key, relation]) => ({
        key,
        field: relationField(key),
        meta: getMeta(relation.entity()),
      })),
    );
  }

  private referenceKeys<E>(meta: EntityMeta<E>): readonly string[] {
    return cachedIn(this.#referenceKeys, meta, () =>
      getKeys(meta.fields).filter((key) => meta.fields[key]?.references),
    );
  }

  // Keyed by the meta object itself; entity metadata is immutable once defined.
  readonly #renamedColumns = new WeakMap<object, readonly [string, string][]>();
  readonly #referenceKeys = new WeakMap<object, readonly string[]>();
  readonly #relationReads = new WeakMap<object, readonly RelationRead[]>();

  public normalizeIds<E extends Document>(meta: EntityMeta<E>, docs: Document[]): E[] {
    return docs.map((doc) => this.normalizeId(meta, doc));
  }

  /** `doc` is the wire shape - `_id`, stored names, `ObjectId`s - and what comes back is the code's. */
  public normalizeId<E extends Document>(meta: EntityMeta<E>, doc: Document): E;
  public normalizeId<E extends Document>(meta: EntityMeta<E>, doc: Document | undefined): E | undefined;
  public normalizeId<E extends Document>(meta: EntityMeta<E>, doc: Document | undefined): E | undefined {
    if (!doc) {
      return doc;
    }

    const res = doc as Record<string, unknown>;
    const _id = ID_KEY;

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
    decodeBigIntsExcept(res, (key) => meta.fields[key]?.type === BigInt);

    for (const { key: relKey, field, meta: relMeta } of this.relationReads(meta)) {
      const value = res[field];
      delete res[field];
      if (value) {
        res[relKey] = Array.isArray(value)
          ? this.normalizeIds(relMeta, value as Document[])
          : this.normalizeId(relMeta, value as Document);
      }
    }

    return res as E;
  }

  /** An aggregate's rows with each 64-bit integer decoded as a document's is: a `bigint` only where the column reads a `BigInt` field. */
  public normalizeAggregateRows<E extends Document, R extends Document>(
    entity: AbstractType<E>,
    q: QueryAggregate<E>,
    rows: R[],
  ): R[] {
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

  /** Whether `key` holds ids the driver stores as `ObjectId`s: the entity's own `_id`, or a reference to one. */
  private holdsKeys<E>(meta: EntityMeta<E>, key: string): boolean {
    return this.pathOf(meta, key) === ID_KEY || !!meta.fields[key]?.references;
  }

  /** Converts every operand `ops` compares a key against with {@link toWireId}, including inside a `$not`. */
  private toWireOperands(ops: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(ops).map(([op, operand]) => [
        op,
        op === '$not' && isRecord(operand)
          ? this.toWireOperands(operand)
          : KEY_OPERATORS.has(op)
            ? this.toWireId(operand)
            : operand,
      ]),
    );
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

  /**
   * A payload as one update pipeline, so every engine's answer holds: a `null` or missing document or array
   * counts as empty, and values go in as `$literal`, so `$x` stays data.
   */
  public getUpdateFilter<E extends Document>(persistable: Partial<E>): Document[] {
    const assignments: Document = {};
    const unset: string[] = [];
    for (const [key, value] of Object.entries(persistable)) {
      if (isFieldUpdateOp(value)) {
        const [op, operand] = fieldUpdateOf(key, value);
        assertNoRaw(operand, 'a write');
        assignments[key] = { [MONGO_ARITHMETIC[op]]: [{ $ifNull: [`$${key}`, 0] }, { $literal: operand }] };
      } else if (isJsonUpdateOp(value)) {
        const update = foldJson(value);
        if ('array' in update) {
          assignments[key] = arrayWrite(key, update.array);
        } else {
          Object.assign(assignments, jsonAssignments(key, update.object));
          unset.push(...update.object.unset.map((path) => `${key}.${path}`));
        }
      } else {
        assignments[key] = { $literal: value };
      }
    }
    return [...(hasKeys(assignments) ? [{ $set: assignments }] : []), ...unsetOf(unset)];
  }

  /** Refuses a key left to MongoDB that it cannot mint: only an `ObjectId`, read back as a string, so not a `Number`. */
  private assertMintableKey<E>(meta: EntityMeta<E>, field: FieldOptions): void {
    if (columnFamily(field.type) === 'string') {
      return;
    }
    throw new UqlUsageError(
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
      // The key is `_id` on an insert and immutable on an update, so it is left out of one: written under its
      // own name beside the `_id` the driver minted, it would be unreachable by the value the caller held.
      const named = inserting && it[idKey] != null;
      if (inserting && !named) {
        // Nothing named the key, so the database is being asked to mint one.
        this.assertMintableKey(meta, fieldOf(meta, idKey));
      }
      const doc: Document = named ? { [ID_KEY]: this.toWireId(it[idKey]) } : {};
      for (const key of filterFieldKeys(meta, it, callbackKey)) {
        if (key === idKey) continue;
        const field = fieldOf(meta, key);
        const value = it[key];
        assertNoRaw(value, 'a write');
        doc[this.resolveColumnName(key, field)] = field.references ? this.toWireId(value) : value;
      }
      // Keyed by column, which the driver's types read as `E`'s keys: they name the same fields.
      return doc as Partial<E>;
    });
  }

  /**
   * Build MongoDB aggregation pipeline stages from a QueryAggregate.
   */
  public buildAggregateStages<E extends Document>(
    entity: AbstractType<E>,
    q: QueryAggregate<E>,
    opts?: QueryOptions,
  ): MongoAggregationPipelineEntry<Document>[] {
    const meta = getMeta(entity);
    const { joins, where } = resolveGroupJoins(meta, q);
    const matched: Lookup = { stages: [], temps: [] };
    const match = this.matchStages(entity, where, opts, [], matched);
    const { groupId, accumulators, columns, lookups } = this.buildGroupSpec(
      meta,
      parseGroupMap(q.$group, q.$select),
      joins,
      matched.temps,
    );
    const pipeline: MongoAggregationPipelineEntry<Document>[] = [
      ...match,
      // What the `$group` reads off each matched row through a lookup, the temporaries it then drops.
      ...lookups,
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
   * size, and a `$sum` as null where it read no value, as SQL answers it. `lookups` puts on each matched
   * row what the group reads through one: a relation aggregate, and an aggregate's relation condition,
   * past the `matched` temporaries, whose relation aggregates are on the row already.
   */
  private buildGroupSpec<E>(
    meta: EntityMeta<E>,
    groupEntries: ParsedGroupEntry<E>[],
    joins: QueryJoins,
    matched: readonly string[],
  ): {
    groupId: Record<string, string>;
    accumulators: Record<string, Record<string, unknown>>;
    columns: Record<string, unknown>;
    lookups: MongoAggregationPipelineEntry<Document>[];
  } {
    if (!groupEntries.length) {
      throw new UqlUsageError('aggregate requires at least one $group column or $select function');
    }
    const groupId: Record<string, string> = {};
    const accumulators: Record<string, Record<string, unknown>> = {};
    const columns: Record<string, unknown> = {};
    const lookup: Lookup = { stages: [], temps: [...matched] };

    for (const entry of groupEntries) {
      // Aliases stay as the caller wrote them ($project maps them back); the *refs* address columns.
      if (entry.kind === 'key') {
        groupId[entry.alias] = `$${this.groupedPath(meta, joins, entry.path, lookup)}`;
        columns[entry.alias] = `$_id.${entry.alias}`;
        continue;
      }
      const { field } = entry;
      if (field !== undefined) {
        this.appendAggregateField(meta, field, lookup);
      }
      const test = entry.where && this.whereExpression(meta, entry.where, lookup);
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
        accumulators[entry.alias] = { $sum: read(countOf(ref), 0) };
      } else {
        // `$sum`, `$avg`, `$min` and `$max` are MongoDB accumulators of the same name, and skip a null.
        accumulators[entry.alias] = { [entry.op]: read(ref, null) };
      }
      if (entry.op === '$sum' && !entry.distinct) {
        const counted = `${SUM_COUNT_ALIAS}_${entry.alias}`;
        accumulators[counted] = { $sum: read(countOf(ref), 0) };
        columns[entry.alias] = { $cond: [{ $eq: [`$${counted}`, 0] }, null, `$${entry.alias}`] };
      }
    }

    return { groupId, accumulators, columns, lookups: lookup.stages };
  }

  /** The field a grouped path reads, on the document or on the joined one its lookup unwound. */
  private groupedPath<E>(meta: EntityMeta<E>, joins: QueryJoins, path: readonly string[], lookup: Lookup): string {
    const { key, join } = groupPathField(joins, path);
    if (!join) {
      this.appendAggregateField(meta, key, lookup);
      return this.columnOf(meta, key);
    }
    if (aggregateOf(join.meta.fields[key])) {
      throw new UqlUsageError(
        `cannot $group by '${path.join('.')}' on MongoDB: a joined row's relation aggregate is not read`,
      );
    }
    return `${joinedPath(join)}.${this.columnOf(join.meta, key)}`;
  }

  /**
   * An aggregate's own `$where` as the expression a `$cond` tests, matching the rows {@link renderFilter}
   * would: a `$match` cannot sit inside a `$group`, and `$text`, bound to the pipeline's first stage, is
   * refused by name. `lookup` gathers the lookups it tests: a relation condition's, and a relation aggregate's.
   */
  private whereExpression<E>(meta: EntityMeta<E>, where: QueryWhere<E>, lookup: Lookup): unknown {
    const terms = getKeys(where).map((key): unknown => {
      if (isGroupOp(key)) {
        const { join, negate } = GROUP_OPS[key];
        const clauses = groupClauses(key, where[key]).map((clause) => {
          assertNoRaw(clause, 'an aggregate $where');
          return this.whereExpression(meta, clause, lookup);
        });
        return negate ? { $not: [{ [join]: clauses }] } : { [join]: clauses };
      }
      const val: unknown = where[key];
      assertNoRaw(val, 'an aggregate $where');
      if (meta.relations[key]) {
        return this.relationExpression(meta, key, val, lookup);
      }
      if (key.startsWith('$')) {
        throw new UqlUsageError(`aggregate $where operator '${key}' is not supported on MongoDB`);
      }
      this.assertKnownPathRoot(meta, key);
      this.appendAggregateField(meta, key, lookup);
      const wire = this.holdsKeys(meta, key) ? (value: unknown) => this.toWireId(value) : undefined;
      return this.fieldExpression(`$${this.pathOf(meta, key)}`, val, wire);
    });
    return allOf(terms);
  }

  /**
   * One field's condition as an expression, read as {@link transformOperators} reads it in a query: a value
   * it equals, a list it is in, or operators. `wire` converts what a key field is compared with.
   */
  private fieldExpression(ref: string, val: unknown, wire = (value: unknown) => value): unknown {
    const equals = (value: unknown) => (value === null ? isNullExpr(ref) : { $eq: [ref, literal(wire(value))] });
    const within = (op: string, values: unknown) => ({
      $in: [{ $ifNull: [ref, null] }, literal(wire(inOperands(op, values)))],
    });
    const ordered = (op: string, operand: unknown) => {
      const value = wire(operand);
      return { $and: [sameType(ref, value), { [op]: [ref, literal(value)] }] };
    };
    if (!isOperatorObject(val)) {
      return Array.isArray(val) ? within('$in', val) : equals(val);
    }
    const terms = Object.entries(val).map(([op, operand]): unknown => {
      const like = LIKE_OPS.get(op);
      if (like) {
        return regexMatch(ref, likeRegex(like.pattern(String(operand))), like.insensitive);
      }
      switch (op) {
        case '$eq':
          return equals(operand);
        case '$ne':
          return { $not: [equals(operand)] };
        case '$not':
          return { $not: [this.fieldExpression(ref, operand, wire)] };
        case '$gt':
        case '$gte':
        case '$lt':
        case '$lte':
          return ordered(op, operand);
        case '$between': {
          const [min, max] = betweenBounds(operand);
          return { $and: [ordered('$gte', min), ordered('$lte', max)] };
        }
        case '$in':
          return within(op, operand);
        case '$nin':
          return { $not: [within(op, operand)] };
        case '$isNull':
        case '$isNotNull':
          return (op === '$isNull') === Boolean(operand) ? equals(null) : { $not: [equals(null)] };
        case '$regex':
          return regexMatch(ref, String(operand));
        case '$size':
          return arraySize(ref, operand);
        case '$all':
          return this.allHeld(ref, inOperands(op, operand));
        case '$elemMatch':
          return this.allHeld(ref, [operand]);
        case '$near':
          throw nearRefusal();
        default:
          throw new UqlUsageError(`unknown operator: ${op}`);
      }
    });
    return allOf(terms);
  }

  /**
   * What `ref` satisfies to hold `value`, as {@link held} reads it in a query: an array each of its
   * elements, an object each of its keys as a path, anything else as a field condition.
   */
  private heldExpression(ref: string, value: unknown): unknown {
    if (Array.isArray(value)) {
      return this.allHeld(ref, value);
    }
    if (isJsonObject(value)) {
      return allOf(Object.entries(value).map(([key, item]) => this.heldExpression(`${ref}.${key}`, item)));
    }
    return this.fieldExpression(ref, value);
  }

  /**
   * `$all`, as {@link allHolding} reads it: the array at `ref` has an element holding each value, a scalar
   * by `$in`, which stops at the first match where testing each element would map them all.
   */
  private allHeld(ref: string, values: readonly unknown[]): unknown {
    return allOf(
      values.map((value) =>
        isOperatorMap(value) || Array.isArray(value)
          ? anyElement(ref, this.heldExpression('$$this', value))
          : { $cond: [{ $isArray: ref }, { $in: [literal(value), ref] }, false] },
      ),
    );
  }

  private buildHavingFilter(having: Record<string, unknown>): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    assertNoUndefined(having, '$having');
    for (const [alias, condition] of Object.entries(having)) {
      // Classified exactly as the SQL side classifies a `$where`/`$having` value, so the two agree
      // on identical input. Keeping only numbers and objects dropped a string or boolean without a
      // word, handing back every group instead of the filtered ones.
      if (isOperatorMap(condition)) {
        filter[alias] = this.transformOperators(condition, 'unsupported HAVING operator');
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
  private extractVectorSort<E extends Document>(sort: QuerySortMap<E> | undefined): ExtractedVectorSort<E> | undefined {
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
  private buildVectorSearchStage<E extends Document>(
    entity: AbstractType<E>,
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
      throw new UqlUsageError(`Field '${key}' not found in entity '${meta.name}'`);
    }
    const colName = this.resolveColumnName(key, field);
    const index = findVectorIndex(meta, key);
    const ranked = indexedDistance(meta, key, index);
    if (search.$distance !== undefined && search.$distance !== ranked) {
      throw new UqlUsageError(
        `cannot rank '${meta.entity.name}.${key}' by '${search.$distance}' on MongoDB: its Atlas index ranks by '${ranked}'`,
      );
    }

    const indexName = this.vectorSearchIndexName(index?.name, colName);

    if (!limit) {
      throw new UqlUsageError(`$vectorSearch requires $limit (vector sort on '${key}' of '${meta.name}')`);
    }

    const stage: Record<string, unknown> = {
      index: indexName,
      path: colName,
      queryVector: [...search.$vector],
      // `$candidates` is the caller's own budget; the fallback is 10x the limit, which is what Atlas
      // suggests as a floor. Either way it is clamped: Atlas rejects a stage asking for more.
      numCandidates: Math.min(candidates ?? limit * 10, MAX_NUM_CANDIDATES),
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

type ExtractedVectorSort<E> = {
  readonly vectorKey: string;
  readonly vectorSearch: QueryVectorSearch;
  readonly regularSort: QuerySortMap<E>;
};

/** A sort direction in MongoDB's form: `-1` for descending, else `1`. MongoDB accepts no other values. */
function sortDirection(value: unknown): 1 | -1 {
  return parseSortDirection(value).desc ? -1 : 1;
}

/**
 * A `computed` field writing SQL is refused wherever a query names it, since no document engine
 * evaluates SQL and answering with the property name would hand back `undefined` for every row. One
 * computing a relation aggregate is read: `appendAggregateField` builds it.
 */
function assertReadable<E>(meta: EntityMeta<E>, key: string): void {
  const field = meta.fields[key];
  if (field?.computed && !aggregateOf(field)) {
    throw new UqlUsageError(
      `cannot read '${meta.entity.name}.${key}' on MongoDB: a 'computed' field writing SQL is not something a document engine evaluates`,
    );
  }
}
