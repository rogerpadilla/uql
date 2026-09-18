import { getContext, UqlSecurityError } from '../context/context.js';
import { soleIdOf } from '../entity/metadata/definition.js';
import type { IndexType } from '../schema/types.js';
import {
  type CascadeType,
  type EntityData,
  type EntityId,
  type EntityIndexMeta,
  type EntityMeta,
  type FieldKey,
  type FieldOptions,
  type FieldUpdateOp,
  type FilterOnMissing,
  type JsonUpdateOp,
  type OnFieldCallback,
  type Query,
  type QueryAggMap,
  type QueryAggregateOp,
  type QueryExclude,
  type QueryGroupMap,
  type QueryOptions,
  QueryRaw,
  type QuerySearch,
  type QuerySelect,
  type QuerySelectValue,
  type QuerySizeComparisonOps,
  type QuerySortMap,
  type QueryTextSearchOptions,
  type QueryVectorSearch,
  type QueryWhere,
  type RelationKey,
  resolveAggregateOp,
  SOFT_DELETE_FILTER,
  type UpdatePayload,
} from '../type/index.js';
import { VECTOR_INDEX_TYPES } from '../type/vector.js';
import { getFieldKeys, isDatabaseWritten } from './field.util.js';
import {
  entityName,
  getKeys,
  hasKeys,
  isOperatorObject,
  isScalarId,
  isRecord,
  isWhereMap,
  someKey,
} from './object.util.js';

export type CallbackKey = keyof Pick<FieldOptions, 'onInsert' | 'onUpdate'>;

/** The keys of `payload` a write persists as columns. */
export function filterFieldKeys<E>(
  meta: EntityMeta<E>,
  payload: EntityData<E> | UpdatePayload<E>,
  callbackKey: CallbackKey,
): FieldKey<E>[] {
  return getKeys(payload).filter((key) => {
    const fieldOpts = meta.fields[key];
    return fieldOpts && !isDatabaseWritten(fieldOpts) && (callbackKey !== 'onUpdate' || fieldOpts.updatable !== false);
  });
}

/** Whether `key` is a field the caller writes, and `record` provides a defined value for. */
function isInsertableField<E>(meta: EntityMeta<E>, record: EntityData<E>, key: FieldKey<E>): boolean {
  const field = meta.fields[key];
  return !!field && !isDatabaseWritten(field) && record[key] !== undefined;
}

/**
 * The insertable keys `record` itself carries, as a string, for grouping rows by the statement they
 * can share. Only the row's own keys: the `onInsert` columns {@link getInsertFieldKeys} appends are a
 * property of the entity, identical for every row, so they cannot tell two rows apart.
 */
export function insertShapeOf<E>(meta: EntityMeta<E>, record: EntityData<E>): string {
  let shape = '';
  for (const key of getKeys(record)) {
    if (isInsertableField(meta, record, key)) {
      shape += `${key},`;
    }
  }
  return shape;
}

/** Appends `record`'s not-yet-`seen` insertable keys to `keys`. */
function addInsertFieldKeys<E>(
  meta: EntityMeta<E>,
  record: EntityData<E>,
  seen: Set<FieldKey<E>>,
  keys: FieldKey<E>[],
): void {
  for (const key of getKeys(record)) {
    if (!seen.has(key) && isInsertableField(meta, record, key)) {
      seen.add(key);
      keys.push(key);
    }
  }
}

/**
 * An insert's columns: every record's writable fields in first-seen order, plus every `onInsert` field,
 * whether or not it was filled yet. A record missing one writes its default.
 */
export function getInsertFieldKeys<E>(meta: EntityMeta<E>, payloads: EntityData<E>[]): FieldKey<E>[] {
  const seen = new Set<FieldKey<E>>();
  const keys: FieldKey<E>[] = [];
  for (const record of payloads) {
    addInsertFieldKeys(meta, record, seen, keys);
  }
  for (const key of getKeys(meta.fields) as FieldKey<E>[]) {
    if (meta.fields[key]!.onInsert !== undefined && !seen.has(key)) {
      keys.push(key);
    }
  }
  return keys;
}

export function getFieldCallbackValue(val: OnFieldCallback) {
  return typeof val === 'function' ? val() : val;
}

/**
 * Resolves the value stamped on the soft-delete field when deleting a row.
 * `true` stamps the current timestamp (`new Date()`); any other marker is an {@link OnFieldCallback}.
 */
export function getSoftDeleteValue(field: FieldOptions) {
  return field.softDelete === true ? new Date() : getFieldCallbackValue(field.softDelete as OnFieldCallback);
}

/** Fills each field `callbackKey` generates on `payload` in place, where the caller left it unset. */
export function fillOnFields<E, R extends EntityData<E> | UpdatePayload<E>>(
  meta: EntityMeta<E>,
  payload: R | R[],
  callbackKey: CallbackKey,
): R[] {
  const payloads = Array.isArray(payload) ? payload : [payload];
  const keys = getKeys(meta.fields).filter((key) => meta.fields[key]![callbackKey]!) as FieldKey<E>[];
  if (keys.length === 0) {
    return payloads;
  }
  for (const it of payloads) {
    for (const key of keys) {
      if (it[key] === undefined) {
        it[key] = getFieldCallbackValue(meta.fields[key]![callbackKey]!) as R[typeof key];
      }
    }
  }
  return payloads;
}

/**
 * The relation keys present in `payload` whose cascade configuration allows `action`. Only
 * `payload`'s keys are read, so any keys-bearing object works (an entity, an update payload,
 * or `meta.relations` itself to enumerate every cascadable relation).
 */
export function filterPersistableRelationKeys<E>(
  meta: EntityMeta<E>,
  payload: object,
  action: CascadeType,
): RelationKey<E>[] {
  const keys = getKeys(payload);
  return keys.filter((key) => {
    const relOpts = meta.relations[key];
    return relOpts && isCascadable(action, relOpts.cascade);
  }) as RelationKey<E>[];
}

/**
 * Whether deleting this entity has to delete anything else, which is the reason a delete resolves the
 * matching ids before issuing anything: a child is reached through the ids of its parent.
 */
export function cascadesOnDelete<E>(meta: EntityMeta<E>): boolean {
  return filterPersistableRelationKeys(meta, meta.relations, 'delete').length > 0;
}

export function isCascadable(action: CascadeType, configuration?: boolean | CascadeType): boolean {
  if (typeof configuration === 'boolean') {
    return configuration;
  }
  return configuration === action;
}

/**
 * Whether `q` carries an ordering or a page, so a write has to settle its rows with a read and name
 * them by id. `$sort` counts even without a page: the SQL dialects emit it from the same `search()`
 * that `find` uses, and SQLite rejects `ORDER BY` on an UPDATE that has no `LIMIT`. MongoDB takes
 * neither clause on a write at all.
 */
export function isPagedQuery<E>(q: QuerySearch<E>): boolean {
  return q.$sort !== undefined || q.$limit !== undefined || q.$skip !== undefined;
}

/**
 * `q` selecting nothing but the id: what a write hands its backend's own read builder to settle the
 * rows it will name. The cast is unavoidable - a computed key is not a `QuerySelect` key to the
 * compiler - so it is spelled once here rather than in each querier.
 */
export function idOnlyQuery<E>(meta: EntityMeta<E>, q: QuerySearch<E>): Query<E> {
  return { ...q, $select: Object.fromEntries(meta.ids.map((key) => [key, true])) } as Query<E>;
}

/**
 * The map form of a `$select` value, or `undefined` for the raw-array form. Centralizes the one
 * narrowing cast: `Array.isArray` does not narrow `readonly` arrays out of a union.
 */
export function asSelectMap<E>(select: QuerySelectValue<E> | undefined): QuerySelect<E> | undefined {
  return Array.isArray(select) ? undefined : (select as QuerySelect<E> | undefined);
}

export function normalizeScalarFieldSelection<E>(
  meta: EntityMeta<E>,
  select?: QuerySelect<E>,
  exclude?: QueryExclude<E>,
): FieldKey<E>[] {
  // A positive `$select` (the common case) wins outright and returns
  // before `$exclude` is ever scanned.
  const positiveFields: FieldKey<E>[] = [];
  let excludedFields: Set<FieldKey<E>> | undefined;
  if (select) {
    for (const key of getKeys(select)) {
      if (!(key in meta.fields)) continue;
      if (select[key]) {
        positiveFields.push(key);
      } else {
        excludedFields ??= new Set<FieldKey<E>>();
        excludedFields.add(key);
      }
    }
    if (positiveFields.length) {
      return positiveFields;
    }
  }

  // No positive selection: every field minus the ones excluded by a falsy `$select` entry or a
  // truthy `$exclude` entry.
  if (exclude) {
    for (const key of getKeys(exclude)) {
      if (exclude[key] && key in meta.fields) {
        excludedFields ??= new Set<FieldKey<E>>();
        excludedFields.add(key);
      }
    }
  }

  const allFields = getFieldKeys(meta.fields);
  if (!excludedFields) {
    return allFields;
  }
  const excluded = excludedFields;
  return allFields.filter((it) => !excluded.has(it));
}

/** Type guard: checks whether a sort value is a vector similarity search. */
export function isVectorSearch(value: unknown): value is QueryVectorSearch {
  return value !== null && typeof value === 'object' && '$vector' in (value as Record<string, unknown>);
}

/**
 * The vector search a `$sort` carries, if it ranks by one. First entry wins when two fields are
 * ranked at once - one scan for every dialect, so the SQL side and MongoDB cannot disagree about
 * which, as they did when one took the first and the other the last.
 */
export function findVectorSort<E>(
  sort: QuerySortMap<E> | undefined,
): { key: string; search: QueryVectorSearch } | undefined {
  for (const key of getKeys(sort)) {
    const search = sort?.[key];
    // The guard narrows here, where a `.find()` over entries would hand back an untyped tuple.
    if (isVectorSearch(search)) {
      return { key, search };
    }
  }
  return undefined;
}

/** `$candidates`, checked: it can be spelled into a statement, and `/http` input is untyped. */
export function vectorCandidates(q: { readonly $candidates?: number }): number | undefined {
  const candidates = q.$candidates;
  if (candidates !== undefined && (!Number.isInteger(candidates) || candidates < 1)) {
    throw new TypeError(`$candidates must be a positive integer, got ${JSON.stringify(candidates)}`);
  }
  return candidates;
}

/**
 * Every index type that means "vector" to some engine: pgvector's two, the generic one MariaDB and
 * CockroachDB share, and Atlas's. Wider than {@link VECTOR_INDEX_TYPES}, which is the set whose DDL
 * depends on a distance metric - Atlas takes its metric from the index definition instead.
 */
const VECTOR_INDEX_MATCH: ReadonlySet<IndexType> = new Set<IndexType>([...VECTOR_INDEX_TYPES, 'vectorSearch']);

/**
 * The vector index declared on `key`, if any. Answers both "is there an ANN index to tune here" and
 * "which kind", which decide the name Atlas is queried by and the setting Postgres is tuned with.
 */
export function findVectorIndex<E>(meta: EntityMeta<E>, key: string): EntityIndexMeta<E> | undefined {
  return meta.indexes?.find(
    (index) => index.type !== undefined && VECTOR_INDEX_MATCH.has(index.type) && indexCoversColumn(index, key),
  );
}

/**
 * Whether a `$where` filters by vector distance anywhere in its tree, `$and`/`$or`/`$not` included.
 * What tells Postgres that an HNSW scan needs to iterate rather than return one candidate list.
 */
export function hasVectorNear(where: unknown): boolean {
  if (where === null || typeof where !== 'object') {
    return false;
  }
  if (Array.isArray(where)) {
    return where.some(hasVectorNear);
  }
  return Object.entries(where).some(([key, value]) => key === '$near' || hasVectorNear(value));
}

function indexCoversColumn<E>(index: EntityIndexMeta<E>, key: string): boolean {
  return index.columns.some((entry) => entry.column === key);
}

/** `satisfies` ties this to {@link JsonUpdateOp}, so renaming an operator breaks it at compile time. */
const JSON_UPDATE_OPS: readonly string[] = [
  '$set',
  '$unset',
  '$push',
  '$pull',
] as const satisfies readonly (keyof JsonUpdateOp)[];

/** Type guard: checks whether an update payload value is a JSON operator object. */
export function isJsonUpdateOp(value: unknown): value is JsonUpdateOp {
  return isRecord(value) && someKey(value, (key) => JSON_UPDATE_OPS.includes(key));
}

/** `satisfies` ties this to {@link FieldUpdateOp}, so renaming an operator breaks it at compile time. */
const FIELD_UPDATE_OPS: readonly string[] = ['$inc', '$mul'] as const satisfies readonly (keyof FieldUpdateOp)[];

/** Type guard: checks whether an update payload value is a scalar field's operator. */
export function isFieldUpdateOp(value: unknown): value is FieldUpdateOp {
  return isRecord(value) && someKey(value, (key) => FIELD_UPDATE_OPS.includes(key));
}

/** The one operator a scalar field's update carries, and its operand. */
export function fieldUpdateOf(value: FieldUpdateOp): [keyof FieldUpdateOp, number | bigint] {
  return value.$inc === undefined ? ['$mul', value.$mul] : ['$inc', value.$inc];
}

/**
 * The `$where` naming rows by key: a bare value names the one key column (refused on a composite), a
 * composite's key map is a `$where` already, and a list is an `IN` of bare values or an OR of maps.
 */
export function whereIds<E>(meta: EntityMeta<E>, ids: EntityId<E> | EntityId<E>[]): QueryWhere<E> {
  if (Array.isArray(ids) ? ids.every(isScalarId) : isScalarId(ids)) {
    return { [soleIdOf(meta, 'addressing by a bare id value')]: ids } as QueryWhere<E>;
  }
  return (Array.isArray(ids) ? { $or: ids } : ids) as QueryWhere<E>;
}

/**
 * Refuses a `$where` that is not a map. Untyped JS and parsed JSON can still pass an id or a list of
 * them, and a scalar read as a map has no keys: the statement would address every row.
 */
export function assertWhere<E>(meta: EntityMeta<E>, where: unknown): void {
  if (!isWhereMap(where)) {
    throw new TypeError(`$where on '${entityName(meta)}' must be a map of conditions, such as { id: 1 }`);
  }
}

/** Returns a `QueryOptions.filters` value with the built-in soft-delete filter disabled (used by hard delete). */
export function withoutSoftDeleteFilter(filters: QueryOptions['filters']): QueryOptions['filters'] {
  return filters === false ? false : { ...filters, [SOFT_DELETE_FILTER]: false };
}

/**
 * `$where` with the entity's active filters merged in, against the ambient {@link UqlContext}. A convenience
 * filter yields to a `$where` on its key; a `security` one is always ANDed, and throws where its condition
 * resolves to nothing, unless `onMissing: 'skip'`.
 */
export function applyFilters<E>(meta: EntityMeta<E>, whereMap: QueryWhere<E>, opts?: QueryOptions): QueryWhere<E> {
  if (!meta.filters) {
    return whereMap;
  }
  const context = getContext();
  const result: Record<string, unknown> = { ...whereMap };
  const securityConditions: unknown[] = [];

  for (const name of getKeys(meta.filters)) {
    const filter = meta.filters[name];

    let active: boolean;
    if (filter.security) {
      active = true;
    } else if (opts?.filters === false) {
      active = false;
    } else {
      active = opts?.filters?.[name] ?? filter.default !== false;
    }
    if (!active) {
      continue;
    }

    const condition = typeof filter.where === 'function' ? filter.where(context) : filter.where;
    if (condition === undefined) {
      const onMissing: FilterOnMissing = filter.onMissing ?? (filter.security ? 'throw' : 'skip');
      if (onMissing === 'throw') {
        throw new UqlSecurityError(`filter '${name}' on '${entityName(meta)}' could not resolve (missing context)`);
      }
      continue;
    }

    const conditionMap = condition as Record<string, unknown>;
    if (!hasKeys(conditionMap)) {
      continue; // resolved to "no restriction" (e.g. a trusted system context) - nothing to merge
    }
    if (filter.security) {
      securityConditions.push(conditionMap);
    } else {
      for (const key of getKeys(conditionMap)) {
        if (result[key] === undefined) {
          result[key] = conditionMap[key];
        }
      }
    }
  }

  if (securityConditions.length) {
    const existing = result['$and'] as unknown[] | undefined;
    result['$and'] = existing ? [...existing, ...securityConditions] : securityConditions;
  }

  return result as QueryWhere<E>;
}

/**
 * Parsed entry from a `$group` map - either a raw group key or an aggregate function call.
 */
export type ParsedGroupEntry<E = object> =
  | {
      readonly kind: 'key';
      readonly alias: string;
      /** The field it reads, behind the to-one relations leading to it: `['transaction', 'orderId']`. */
      readonly path: readonly string[];
    }
  | {
      readonly kind: 'fn';
      readonly alias: string;
      readonly op: QueryAggregateOp;
      readonly fieldRef: string;
      /** `true` for `$countDistinct`: `COUNT(DISTINCT field)`. */
      readonly distinct: boolean;
      /** The rows it reads, where not all of the statement's. */
      readonly where?: QueryWhere<E>;
    };

/**
 * The `$size` of a relation condition, `{ comments: { $size: { $gte: 2 } } }`, or `undefined` where it
 * filters the target's fields; a mix of the two, `{ $size: 2, name: 'x' }`, is refused.
 */
export function parseRelationSize(val: unknown): number | QuerySizeComparisonOps | undefined {
  if (!val || typeof val !== 'object' || !('$size' in val)) {
    return undefined;
  }
  const siblings = getKeys(val).filter((key) => key !== '$size');
  if (siblings.length) {
    throw new TypeError(`$size on a relation cannot be combined with other conditions: ${siblings.join(', ')}`);
  }
  return (val as { $size: number | QuerySizeComparisonOps }).$size;
}

/**
 * The direction a `$sort` orders a to-many relation by its size, or `undefined` when the value is a
 * map of the relation's own fields (which only a to-one can be ordered by). Mirrors
 * {@link parseRelationSize}, the same clause spelled for a filter rather than an ordering.
 */
export function parseSortByCount(val: unknown): unknown {
  if (!val || typeof val !== 'object' || !('$count' in val)) {
    return undefined;
  }
  const siblings = getKeys(val).filter((key) => key !== '$count');
  if (siblings.length) {
    throw new TypeError(`$count in a $sort cannot be combined with other keys: ${siblings.join(', ')}`);
  }
  return val.$count;
}

/**
 * Parse the `$group` (grouped columns) and `$select` (computed aggregates) maps into structured
 * entries consumable by any dialect. Grouped columns come first, then computed columns.
 */
export function parseGroupMap<E>(group?: QueryGroupMap<E>, select?: QueryAggMap<E>): ParsedGroupEntry<E>[] {
  const entries: ParsedGroupEntry<E>[] = [];
  const groupMap = group ?? {};
  for (const alias of getKeys(groupMap)) {
    const ref: unknown = groupMap[alias];
    if (ref) {
      entries.push({ kind: 'key', alias, path: ref === true ? [alias] : groupRefPath(alias, ref) });
    }
  }
  if (!select) {
    return entries;
  }
  for (const alias of getKeys(select)) {
    const { $where: where } = select[alias];
    const call: Readonly<Record<string, unknown>> = select[alias];
    const key = getKeys(call).find((name) => name !== '$where');
    if (key === undefined) {
      throw new TypeError(`aggregate '${alias}' names no op, only a $where`);
    }
    // `$countDistinct` normalizes to `$count` plus a `distinct` flag.
    const { op, distinct } = resolveAggregateOp(key);
    const fieldRef = aggregateFieldRef(alias, call[key]);
    entries.push({ kind: 'fn', alias, op, fieldRef, distinct, ...(hasKeys(where) ? { where } : {}) });
  }
  return entries;
}

/** The path a group key's `{ transaction: { orderId: true } }` names, one key at each level. */
function groupRefPath(alias: string, ref: unknown): string[] {
  const [key, ...rest] = isRecord(ref) ? getKeys(ref) : [];
  if (!isRecord(ref) || key === undefined || rest.length) {
    throw new TypeError(`$group '${alias}' names one field by the path to it: got ${JSON.stringify(ref)}`);
  }
  return ref[key] === true ? [key] : [key, ...groupRefPath(alias, ref[key])];
}

/** The column an aggregate reads: `'*'`, or the one field its `{ field: true }` names. */
function aggregateFieldRef(alias: string, arg: unknown): string {
  const [field, ...rest] = arg === '*' ? [arg] : namedKeys(arg);
  if (field === undefined || rest.length) {
    throw new TypeError(`aggregate '${alias}' takes one field as { field: true }, or '*': got ${JSON.stringify(arg)}`);
  }
  return field;
}

/** The keys a `{ key: true }` map switches on; anything that is not such a map switches on none. */
function namedKeys(map: unknown): string[] {
  return isRecord(map) ? getKeys(map).filter((key) => map[key]) : [];
}

/**
 * Whether `value` is a map of comparison operators rather than a value to compare against. Only a
 * plain object qualifies: `Date`, `QueryRaw`, `Uint8Array` and arrays are all `typeof 'object'`, and
 * reading their keys as operators drops the condition (a `Date` has none) or throws on an array's
 * indices. Shared by the SQL and MongoDB builders, whose `$where` and `$having` all face this.
 */
export function isOperatorMap(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof Uint8Array) &&
    !(value instanceof QueryRaw)
  );
}

/** A JSON object, matched by what it holds: a plain object with no operator key. */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return isOperatorMap(value) && !isOperatorObject(value);
}

/**
 * A page operand, checked before it reaches an engine. These arrive from page arithmetic and from
 * REST query strings (`parseQueryParams` yields `NaN` for a non-numeric one), and each engine's own
 * complaint names neither the clause nor the value - or, for `$limit: 0`, quietly means something
 * else. Shared so every backend rejects the same input.
 */
export function assertNonNegativeInteger(value: number, clause: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${clause} must be a non-negative integer, got ${value}`);
  }
  return value;
}

/**
 * Rejects a `$having`/`$sort` key naming something an aggregate does not emit. Its rows are its
 * `$group` columns and its `$select` aliases; anything else is a value that is not there. Shared so
 * SQL and MongoDB refuse the same query with the same words.
 */
export function throwUnknownAggregateColumn(key: string, clause: string): never {
  throw new TypeError(`cannot ${clause} by '${key}': it is neither a $group column nor a $select alias`);
}

/** {@link throwUnknownAggregateColumn} over every key of a clause, for backends that check up front. */
export function assertAggregateColumns(clauseMap: object, emitted: ReadonlySet<string>, clause: string): void {
  for (const key of getKeys(clauseMap)) {
    if (!emitted.has(key)) {
      throwUnknownAggregateColumn(key, clause);
    }
  }
}

/** The text-search config a fulltext index builds with where it states none: language-neutral, no stemming. */
const DEFAULT_TEXT_CONFIG = 'simple';

/** The text-search config a fulltext index builds with, which a search it serves has to parse with too. */
export function fulltextConfig(index: { readonly config?: string }): string {
  return index.config ?? DEFAULT_TEXT_CONFIG;
}

/** The largest weight MongoDB's text index takes, which truncates a fraction to the whole number below. */
const MAX_TEXT_WEIGHT = 99_999;

/**
 * Each column's weight in a fulltext index, 1 where it states none, or none at all where they are alike.
 * Checked wherever it is read, so the migration, the search and its rank refuse the same declaration.
 */
export function fulltextWeights(index: {
  readonly type?: IndexType;
  readonly entries: readonly { readonly weight?: number }[];
}): readonly number[] | undefined {
  if (!index.entries.some((entry) => entry.weight !== undefined)) {
    return undefined;
  }
  if (index.type !== 'fulltext') {
    throw new TypeError(`a column weight ranks a fulltext index, and this one is ${index.type ?? 'btree'}`);
  }
  const weights = index.entries.map(({ weight = 1 }) => {
    if (!Number.isInteger(weight) || weight < 1 || weight > MAX_TEXT_WEIGHT) {
      throw new TypeError(`a column weight is a whole number from 1 to ${MAX_TEXT_WEIGHT}, not ${weight}`);
    }
    return weight;
  });
  return new Set(weights).size > 1 ? weights : undefined;
}

/**
 * A weighted fulltext index's lightest weight, and what each column weighs beyond it: the score over every
 * column counts the lightest, and a column weighing more adds its own score times the rest.
 */
export function textWeightSteps(weights: readonly number[]): { lightest: number; extra: number[] } {
  const lightest = Math.min(...weights);
  return { lightest, extra: weights.map((weight) => weight - lightest) };
}

/** The fulltext index over exactly `fields`, in order, which a search of them is served by. */
export function fulltextIndexOver<E>(meta: EntityMeta<E>, fields: readonly string[]): EntityIndexMeta<E> | undefined {
  return meta.indexes?.find(
    (index) =>
      index.type === 'fulltext' &&
      index.columns.length === fields.length &&
      index.columns.every((entry, at) => entry.column === fields[at]),
  );
}

/**
 * The search a `$sort` by `$text` ranks by: the one at the root of the same query's `$where`. A nested or
 * negated one has no score to order by, and MongoDB scores only the one `$text` it allows.
 */
export function rankedTextSearch<E>(where: QueryWhere<E> | undefined): QueryTextSearchOptions<E> {
  if (!where?.$text) {
    throw new TypeError('$sort by $text ranks by the $text at the root of $where, which this query has none of');
  }
  return where.$text;
}

/**
 * The fields a `$text` searches: those it names, or else the columns of the entity's fulltext index,
 * the declaration MySQL's `MATCH` has to name exactly and a MongoDB text index already is. Refused
 * where neither says, rather than guessed: every engine answers a guess with an error of its own.
 */
export function textSearchFields<E>(meta: EntityMeta<E>, search: QueryTextSearchOptions<E>): readonly string[] {
  const named = namedKeys(search.$fields);
  if (named.length) {
    return named;
  }
  const fulltext = (meta.indexes ?? []).filter((index) => index.type === 'fulltext');
  if (fulltext.length === 1) {
    return fulltext[0].columns.flatMap((entry) => (typeof entry.column === 'string' ? [entry.column] : []));
  }
  const name = entityName(meta);
  const declared = fulltext.length
    ? `${fulltext.length} fulltext indexes to choose from`
    : 'no fulltext index to search';
  throw new TypeError(
    `$text on '${name}' names no $fields, and '${name}' declares ${declared}. Name them with $fields.`,
  );
}
