import { getContext } from '../context/context.js';
import { namesKey } from '../entity/metadata/definition.js';
import type { IndexType } from '../schema/types.js';
import {
  type AggregateCall,
  type CascadeType,
  type EntityData,
  type EntityIndexMeta,
  type EntityMeta,
  type FieldKey,
  type FieldOptions,
  type FieldUpdateOp,
  type FilterOnMissing,
  type FilterOptions,
  type JsonArrayUpdateOp,
  type JsonScalar,
  type JsonUpdateOp,
  type OnFieldCallback,
  type QueryAggMap,
  type QueryConflictKeys,
  type QueryUpsert,
  type QueryGroupMap,
  type QueryOptions,
  QuerySql,
  type QuerySearch,
  type QuerySelect,
  type QuerySelectValue,
  type QuerySortDirection,
  type QuerySizeComparisonOps,
  type QuerySortMap,
  type QueryTextSearchOptions,
  type QueryVectorQuery,
  type QueryVectorSearch,
  type QueryWhere,
  type RelationKey,
  resolveAggregateOp,
  type UpdatePayload,
  type VectorDistance,
} from '../type/index.js';
import { DEFAULT_VECTOR_DISTANCE, VECTOR_INDEX_TYPES } from '../type/vector.js';
import { defaultReadKeys, fieldKeys, isDatabaseWritten, jsonKey, jsonPathKeys } from './field.util.js';
import { withDeleted } from './filters.util.js';
import {
  entityName,
  getKeys,
  omitKeys,
  hasKeys,
  isJsonScalar,
  isOperatorObject,
  isRecord,
  someKey,
} from './object.util.js';
import { assertNoUndefined, whereAnd } from './query.util.js';
import { UqlSecurityError, UqlUsageError } from './uqlError.js';

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
  return [...keys, ...filledKeys(meta, 'onInsert').filter((key) => !seen.has(key))];
}

export function getFieldCallbackValue(val: OnFieldCallback) {
  return typeof val === 'function' ? val() : val;
}

/**
 * The value a soft delete stamps on `field`: `true` stamps the current timestamp (`new Date()`); any other marker
 * is an {@link OnFieldCallback}.
 */
function softDeleteValue(field: FieldOptions): unknown {
  return field.softDelete === true ? new Date() : getFieldCallbackValue(field.softDelete as OnFieldCallback);
}

/** A delete as {@link deletionOf} plans it. */
type Deletion<O> = {
  readonly stamp?: { readonly key: string; readonly field: FieldOptions; value(): unknown };
  readonly opts: O;
};

/**
 * How a delete of `meta` goes: a soft one stamps its field (`stamp`, whose `value()` the writer takes, so a
 * callback runs only where a row is written), reading the rows as `opts` filters them; a hard one, asked for or on
 * an entity with no soft-delete field, removes them, soft-deleted ones included.
 */
export function deletionOf<E, O extends QueryOptions>(meta: EntityMeta<E>, opts: O): Deletion<O> {
  const key = opts.hardDelete ? undefined : meta.softDelete;
  const field = key === undefined ? undefined : meta.fields[key];
  if (key === undefined || !field) {
    return { opts: withDeleted(opts) };
  }
  return { stamp: { key, field, value: () => softDeleteValue(field) }, opts };
}

/**
 * What the row an upsert of `row` finds takes: a copy of `q.$update`, none for `{}`, which leaves it as `DO NOTHING`
 * does, and by default the payload less its key and what it matched on.
 */
export function foundRowAssigned<E>(
  meta: EntityMeta<E>,
  q: QueryUpsert<E>,
  row: EntityData<E>,
): UpdatePayload<E> | undefined {
  const update = q.$update;
  if (update === undefined) {
    return omitKeys(row, [...meta.ids, ...getKeys(q.$conflict)]);
  }
  return hasKeys(update) ? { ...update } : undefined;
}

/**
 * Whether an upsert of `row` lands under the key it names: it names one and matches on it, so a row it finds
 * has that key too. Elsewhere the key is the found row's, which the upsert reads back.
 */
export function upsertKeepsOwnKey<E>(meta: EntityMeta<E>, conflictKeys: QueryConflictKeys<E>, row: E): boolean {
  return namesKey(meta, row) && meta.ids.every((key) => Object.hasOwn(conflictKeys, key));
}

/**
 * Where a write runs: a statement uql sends, or a trigger's body, which runs no JavaScript, so a fill there is
 * only a value or SQL; calling a callback would bake one value into the trigger.
 */
export type WriteScope = 'statement' | 'trigger';

/** Fills each field `callbackKey` generates on `payload` in place, where the caller left it unset, as `scope` can. */
export function fillOnFields<E, R extends EntityData<E> | UpdatePayload<E>>(
  meta: EntityMeta<E>,
  payload: R | R[],
  callbackKey: CallbackKey,
  scope: WriteScope = 'statement',
): R[] {
  const payloads = Array.isArray(payload) ? payload : [payload];
  const keys = filledKeys(meta, callbackKey);
  if (keys.length === 0) {
    return payloads;
  }
  for (const it of payloads) {
    for (const key of keys) {
      const fill = meta.fields[key]![callbackKey]!;
      if (it[key] === undefined && (scope === 'statement' || typeof fill !== 'function')) {
        it[key] = getFieldCallbackValue(fill) as R[typeof key];
      }
    }
  }
  return payloads;
}

/** The fields `callbackKey` fills where the caller left them unset. By presence: `onInsert: 0` is a value meant. */
function filledKeys<E>(meta: EntityMeta<E>, callbackKey: CallbackKey): FieldKey<E>[] {
  return fieldKeys(meta, (field) => field[callbackKey] !== undefined);
}

/** The relations a write cascades `action` to, in declaration order. */
export function cascadingRelations<E>(meta: EntityMeta<E>, action: CascadeType): RelationKey<E>[] {
  return getKeys(meta.relations).filter((key): key is RelationKey<E> =>
    isCascadable(action, meta.relations[key]?.cascade),
  );
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

/** Whether `select` is the list form `sql()` fills, narrowing both ways, which `Array.isArray` does not for a `readonly` array. */
export function isSelectList<E>(select: QuerySelectValue<E> | undefined): select is readonly QuerySql[] {
  return Array.isArray(select);
}

/**
 * The fields a `$select` map reads: its positive entries alone where it has one, else every field it leaves in,
 * a falsy entry leaving its field out.
 */
export function normalizeScalarFieldSelection<E>(meta: EntityMeta<E>, select?: QuerySelect<E>): readonly FieldKey<E>[] {
  const positive: FieldKey<E>[] = [];
  let excluded: Set<FieldKey<E>> | undefined;
  for (const key of getKeys(select)) {
    if (!(key in meta.fields)) {
      continue;
    }
    if (select?.[key]) {
      positive.push(key);
    } else {
      excluded ??= new Set<FieldKey<E>>();
      excluded.add(key);
    }
  }
  if (positive.length) {
    return positive;
  }
  const allFields = defaultReadKeys(meta);
  if (!excluded) {
    return allFields;
  }
  return allFields.filter((key) => !excluded.has(key));
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
    throw new UqlUsageError(`$candidates must be a positive integer, got ${JSON.stringify(candidates)}`);
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

/** The metric `key`'s vector index ranks by: its own, else its field's, else cosine. */
export function indexedDistance<E>(
  meta: EntityMeta<E>,
  key: string,
  index: EntityIndexMeta<E> | undefined,
): VectorDistance {
  return index?.distance ?? meta.fields[key]?.distance ?? DEFAULT_VECTOR_DISTANCE;
}

/**
 * The metric a distance to `key` measures by: the search's own, else what its index ranks by. The one
 * fallback every engine resolves, so none can rank by another.
 */
export function vectorDistanceOf<E>(meta: EntityMeta<E>, key: string, search: QueryVectorQuery): VectorDistance {
  return search.$distance ?? indexedDistance(meta, key, findVectorIndex(meta, key));
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
  return index.entries.some((entry) => entry.column === key);
}

/** `satisfies` ties this to {@link JsonUpdateOp}, so renaming an operator breaks it at compile time. */
const JSON_UPDATE_OPS: readonly string[] = [
  '$pull',
  '$set',
  '$push',
  '$addToSet',
  '$unset',
] as const satisfies readonly (keyof JsonUpdateOp)[];

/** Type guard: checks whether an update payload value is a JSON operator object. */
export function isJsonUpdateOp(value: unknown): value is JsonUpdateOp | JsonArrayUpdateOp {
  return isRecord(value) && someKey(value, (key) => JSON_UPDATE_OPS.includes(key));
}

/** An item one array's writes append, `unique` where it goes in only if the stored array lacks it. */
type JsonAppend = { readonly item: unknown; readonly unique: boolean };

/** One array's writes, in order: each pull removes every element equal to it, then each append adds one. */
export type JsonArrayWrites = { readonly pulls: readonly unknown[]; readonly appends: readonly JsonAppend[] };

/** A JSON update with each path written once: the value set at each, each array key's writes, and the paths removed. */
export type JsonWrites = {
  readonly set: Readonly<Record<string, unknown>>;
  readonly arrays: Readonly<Record<string, JsonArrayWrites>>;
  readonly unset: readonly string[];
};

/** Whether the writes put a key into the document, so a NULL column must first become an object. */
export function writesKeys({ set, arrays }: JsonWrites): boolean {
  return hasKeys(set) || Object.values(arrays).some((write) => write.appends.length > 0);
}

/** One array's writes while a JSON update folds. */
type ArrayFold = { pulls: unknown[]; appends: JsonAppend[] };

/** A JSON update as its writes: those of an array column, or those of an object's keys. */
export type JsonUpdate = { readonly array: JsonArrayWrites } | { readonly object: JsonWrites };

/** A JSON update folded as an array column's, where its operands are lists of elements, else as an object's. */
export function foldJson(value: JsonUpdateOp | JsonArrayUpdateOp): JsonUpdate {
  return isJsonArrayUpdate(value) ? { array: foldJsonArrayUpdate(value) } : { object: foldJsonUpdate(value) };
}

/** Whether a JSON update writes the column as an array, its operands lists of elements rather than maps of keys. */
function isJsonArrayUpdate(value: JsonUpdateOp | JsonArrayUpdateOp): value is JsonArrayUpdateOp {
  return [value.$pull, value.$push, value.$addToSet].some(Array.isArray);
}

/**
 * A JSON array column's update as its writes: each `$pull`, then each `$push`, then each `$addToSet` once. Its
 * operands are lists, so one that is a map of keys means the update was written for an object.
 */
function foldJsonArrayUpdate(value: JsonArrayUpdateOp): JsonArrayWrites {
  const { $pull = [], $push = [], $addToSet = [], ...others } = value;
  if (hasKeys(others) || ![$pull, $push, $addToSet].every(Array.isArray)) {
    throw new UqlUsageError('a JSON array takes $pull, $push and $addToSet, each a list of elements');
  }
  const write: ArrayFold = { pulls: [...$pull], appends: [] };
  for (const item of $push) {
    append(write, item, false);
  }
  for (const item of $addToSet) {
    append(write, assertSetElement('$addToSet', item), true);
  }
  return write;
}

/**
 * A JSON update as one write per path, its operators applied in order: `$pull`, `$set` in key order, `$push`,
 * `$addToSet`, `$unset`. Where one reaches a value another wrote, the result is worked out here, so every engine
 * writes each path once and reads only what is stored. A `$set` of `undefined` writes nothing.
 */
function foldJsonUpdate(value: JsonUpdateOp): JsonWrites {
  const set = new Map<string, unknown>();
  const arrays = new Map<string, ArrayFold>();
  const unset = new Set<string>();
  for (const [key, item] of Object.entries(value.$pull ?? {})) {
    arrays.set(jsonKey(key), { pulls: [item], appends: [] });
  }
  for (const [path, item] of Object.entries(value.$set ?? {})) {
    if (item !== undefined) {
      const keys = jsonPathKeys(path);
      arrays.delete(keys[0]);
      dropWithin(set, path);
      const owner = ownerOf(set, keys);
      if (owner) {
        set.set(owner.path, withPath(owner.path, set.get(owner.path), owner.rest, item));
      } else {
        set.set(path, item);
      }
    }
  }
  for (const [key, item] of Object.entries(value.$push ?? {})) {
    appendTo(set, arrays, jsonKey(key), item, false);
  }
  for (const [key, item] of Object.entries(value.$addToSet ?? {})) {
    appendTo(set, arrays, jsonKey(key), assertSetElement(`$addToSet on '${key}'`, item), true);
  }
  for (const path of value.$unset ?? []) {
    const keys = jsonPathKeys(path);
    dropWithin(set, path);
    arrays.delete(path);
    const owner = ownerOf(set, keys);
    if (owner) {
      set.set(owner.path, withoutPath(owner.path, set.get(owner.path), owner.rest));
    } else {
      unset.add(path);
    }
  }
  return { set: Object.fromEntries(set), arrays: Object.fromEntries(arrays), unset: [...unset] };
}

/** `item` appended at `key`: onto the array a `$set` wrote there, or else among the key's array writes. */
function appendTo(
  set: Map<string, unknown>,
  arrays: Map<string, ArrayFold>,
  key: string,
  item: unknown,
  unique: boolean,
): void {
  if (set.has(key)) {
    const written = set.get(key);
    assertNotSql(key, written);
    if (written === null) {
      set.set(key, [item]);
    } else if (Array.isArray(written) && !(unique && written.includes(item))) {
      set.set(key, [...written, item]);
    }
    return;
  }
  if ([...set.keys()].some((path) => path.startsWith(`${key}.`))) {
    return;
  }
  const write = arrays.get(key) ?? { pulls: [], appends: [] };
  arrays.set(key, write);
  append(write, item, unique);
}

/** `item` appended to `write`: a `unique` one only once, and unguarded where a pull removed it. */
function append(write: ArrayFold, item: unknown, unique: boolean): void {
  if (!(unique && write.appends.some((appended) => appended.item === item))) {
    write.appends.push({ item, unique: unique && !write.pulls.includes(item) });
  }
}

/** `item`, refused unless a scalar: the one element every engine compares alike, which `$addToSet` needs. */
function assertSetElement(operator: string, item: unknown): JsonScalar {
  if (!isJsonScalar(item)) {
    throw new UqlUsageError(`${operator} takes a string, a finite number or a boolean`);
  }
  return item;
}

/** Removes `path` and every path inside it from `set`. */
function dropWithin(set: Map<string, unknown>, path: string): void {
  for (const written of set.keys()) {
    if (written === path || written.startsWith(`${path}.`)) {
      set.delete(written);
    }
  }
}

/** The path in `set` holding the value `keys` lead into, and the keys left below it. */
function ownerOf(set: Map<string, unknown>, keys: readonly string[]): { path: string; rest: string[] } | undefined {
  for (let depth = 1; depth < keys.length; depth++) {
    const path = keys.slice(0, depth).join('.');
    if (set.has(path)) {
      return { path, rest: keys.slice(depth) };
    }
  }
  return undefined;
}

/** `value` with `item` at `keys`, a value that is no object becoming one, as a dotted `$set` makes it. */
function withPath(
  path: string,
  value: unknown,
  [key, ...rest]: readonly string[],
  item: unknown,
): Record<string, unknown> {
  assertNotSql(path, value);
  const object = isRecord(value) ? value : {};
  const inner = Object.hasOwn(object, key) ? object[key] : undefined;
  return { ...object, [key]: rest.length > 0 ? withPath(path, inner, rest, item) : item };
}

/** `value` without `keys`, as it is where they lead nowhere. */
function withoutPath(path: string, value: unknown, [key, ...rest]: readonly string[]): unknown {
  assertNotSql(path, value);
  if (!isRecord(value) || !Object.hasOwn(value, key)) {
    return value;
  }
  const { [key]: inner, ...others } = value;
  return rest.length > 0 ? { ...others, [key]: withoutPath(path, inner, rest) } : others;
}

/** Refuses an operator inside a value `sql` sets, whose result the statement cannot know. */
function assertNotSql(path: string, value: unknown): void {
  if (value instanceof QuerySql) {
    throw new UqlUsageError(`'${path}' is set by sql, so no other operator can write inside it`);
  }
}

/** `satisfies` ties this to {@link FieldUpdateOp}, so renaming an operator breaks it at compile time. */
const FIELD_UPDATE_OPS: readonly string[] = ['$inc', '$mul'] as const satisfies readonly (keyof FieldUpdateOp)[];

/** Type guard: checks whether an update payload value is a scalar field's operator. */
export function isFieldUpdateOp(value: unknown): value is FieldUpdateOp {
  return isRecord(value) && someKey(value, (key) => FIELD_UPDATE_OPS.includes(key));
}

/**
 * The one operator a scalar field's update carries, and its operand. Naming both throws rather than
 * reading one: their order would change the result, and an untyped payload is how both arrive.
 */
export function fieldUpdateOf(key: string, value: FieldUpdateOp): [keyof FieldUpdateOp, number | bigint | QuerySql] {
  if (value.$inc !== undefined && value.$mul !== undefined) {
    throw new UqlUsageError(`'${key}' takes one of $inc and $mul`);
  }
  return value.$inc === undefined ? ['$mul', value.$mul] : ['$inc', value.$inc];
}

/**
 * `$where` with the entity's active filters merged in, against the ambient {@link UqlContext}. A convenience
 * filter yields to a `$where` on its key; a `security` one is always ANDed, from {@link securityConditions}.
 */
export function applyFilters<E>(meta: EntityMeta<E>, whereMap: QueryWhere<E>, opts?: QueryOptions): QueryWhere<E> {
  if (!meta.filters) {
    return whereMap;
  }
  const result: Record<string, unknown> = { ...whereMap };
  for (const [name, filter] of Object.entries(meta.filters)) {
    const active = opts?.filters !== false && (opts?.filters?.[name] ?? filter.default !== false);
    if (filter.security || !active) {
      continue;
    }
    const condition: Record<string, unknown> = resolveFilter(meta, name, filter) ?? {};
    for (const key of getKeys(condition)) {
      if (result[key] === undefined) {
        result[key] = condition[key];
      }
    }
  }
  const merged = result as QueryWhere<E>;
  const security = securityConditions(meta).map(([, condition]) => condition);
  return security.length ? whereAnd(merged, security) : merged;
}

/**
 * Each `security` filter's condition, by name, resolved against the ambient context. One resolving to
 * `{}`, a trusted context's "no restriction", is left out. Reads AND these in; writes are held to them.
 */
export function securityConditions<E>(meta: EntityMeta<E>): [name: string, condition: QueryWhere<E>][] {
  return Object.entries(meta.filters ?? {}).flatMap(([name, filter]) => {
    const condition = filter.security ? resolveFilter(meta, name, filter) : undefined;
    return condition && hasKeys(condition) ? [[name, condition]] : [];
  });
}

/** A filter's condition, `undefined` where it resolves to nothing and may skip; throws where it may not. */
function resolveFilter<E>(meta: EntityMeta<E>, name: string, filter: FilterOptions<E>): QueryWhere<E> | undefined {
  const condition = typeof filter.where === 'function' ? filter.where(getContext()) : filter.where;
  const onMissing: FilterOnMissing = filter.onMissing ?? (filter.security ? 'throw' : 'skip');
  if (condition === undefined && onMissing === 'throw') {
    throw new UqlSecurityError(`filter '${name}' on '${entityName(meta)}' could not resolve (missing context)`);
  }
  return condition;
}

/**
 * Holds written rows to the `security` filters, as {@link applyFilters} holds reads: an inserted row gets
 * each field a condition names and it leaves out, and a row naming one must carry the condition's value.
 * A condition other than field equalities refuses the write, having nothing a row can be checked against.
 * See architecture/security-filter-writes.md.
 */
export function guardWrite<E, R extends EntityData<E> | UpdatePayload<E>>(
  meta: EntityMeta<E>,
  rows: readonly R[],
  write: 'insert' | 'update',
): void {
  for (const [name, condition] of securityConditions(meta)) {
    const values: Record<string, unknown> = condition;
    const keys = fieldKeys(meta, () => true).filter((key) => Object.hasOwn(values, key));
    const equalities = keys.length === getKeys(values).length;
    if (!equalities || keys.some((key) => Array.isArray(values[key]) || isOperatorObject(values[key]))) {
      throw new UqlSecurityError(
        `'${entityName(meta)}' security filter '${name}' is not field equalities, so no write can be checked against it`,
      );
    }
    for (const key of keys) {
      for (const row of rows) {
        if (row[key] === undefined) {
          if (write === 'insert') {
            row[key] = values[key] as R[typeof key];
          }
        } else if (row[key] !== values[key]) {
          throw new UqlSecurityError(`'${entityName(meta)}' row sets '${key}' outside security filter '${name}'`);
        }
      }
    }
  }
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
  | (AggregateCall<E> & {
      readonly kind: 'fn';
      readonly alias: string;
      /** `true` for `$countDistinct`: `COUNT(DISTINCT field)`. */
      readonly distinct: boolean;
    });

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
    throw new UqlUsageError(`$size on a relation cannot be combined with other conditions: ${siblings.join(', ')}`);
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
    throw new UqlUsageError(`$count in a $sort cannot be combined with other keys: ${siblings.join(', ')}`);
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
    if (where) {
      assertNoUndefined(where, `the $where of aggregate '${alias}'`);
    }
    const call: Readonly<Record<string, unknown>> = select[alias];
    const key = getKeys(call).find((name) => name !== '$where');
    if (key === undefined) {
      throw new UqlUsageError(`aggregate '${alias}' names no op, only a $where`);
    }
    // `$countDistinct` normalizes to `$count` plus a `distinct` flag.
    const { op, distinct } = resolveAggregateOp(key);
    const field = aggregateField(alias, call[key]);
    if (field === undefined && (op !== '$count' || distinct)) {
      throw new UqlUsageError(`aggregate '${alias}' takes '*' only as a $count`);
    }
    entries.push({ kind: 'fn', alias, op, distinct, ...(field && { field }), ...(hasKeys(where) ? { where } : {}) });
  }
  return entries;
}

/** The path a group key's `{ transaction: { orderId: true } }` names, one key at each level. */
function groupRefPath(alias: string, ref: unknown): string[] {
  const [key, ...rest] = isRecord(ref) ? getKeys(ref) : [];
  if (!isRecord(ref) || key === undefined || rest.length) {
    throw new UqlUsageError(`$group '${alias}' names one field by the path to it: got ${JSON.stringify(ref)}`);
  }
  return ref[key] === true ? [key] : [key, ...groupRefPath(alias, ref[key])];
}

/** The field an aggregate reads, the one its `{ field: true }` names; none for `'*'`, which counts the rows. */
function aggregateField(alias: string, arg: unknown): string | undefined {
  if (arg === '*') {
    return undefined;
  }
  const [field, ...rest] = namedKeys(arg);
  if (field === undefined || rest.length) {
    throw new UqlUsageError(
      `aggregate '${alias}' takes one field as { field: true }, or '*': got ${JSON.stringify(arg)}`,
    );
  }
  return field;
}

/** The keys a `{ key: true }` map switches on; anything that is not such a map switches on none. */
function namedKeys(map: unknown): string[] {
  return isRecord(map) ? getKeys(map).filter((key) => map[key]) : [];
}

/**
 * Whether `value` is a map of comparison operators rather than a value to compare against. Only a
 * plain object qualifies: `Date`, `QuerySql`, `Uint8Array` and arrays are all `typeof 'object'`, and
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
    !(value instanceof QuerySql)
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
    throw new UqlUsageError(`${clause} must be a non-negative integer, got ${value}`);
  }
  return value;
}

/**
 * Rejects a `$having`/`$sort` key naming something an aggregate does not emit. Its rows are its
 * `$group` columns and its `$select` aliases; anything else is a value that is not there. Shared so
 * SQL and MongoDB refuse the same query with the same words.
 */
export function throwUnknownAggregateColumn(key: string, clause: string): never {
  throw new UqlUsageError(`cannot ${clause} by '${key}': it is neither a $group column nor a $select alias`);
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
    throw new UqlUsageError(`a column weight ranks a fulltext index, and this one is ${index.type ?? 'btree'}`);
  }
  const weights = index.entries.map(({ weight = 1 }) => {
    if (!Number.isInteger(weight) || weight < 1 || weight > MAX_TEXT_WEIGHT) {
      throw new UqlUsageError(`a column weight is a whole number from 1 to ${MAX_TEXT_WEIGHT}, not ${weight}`);
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
      index.entries.length === fields.length &&
      index.entries.every((entry, at) => entry.column === fields[at]),
  );
}

/** How a `$sort` orders by `$text`: its direction, and the name it answers the relevance under, if any. */
export function textSortOf<E>(
  sort: QuerySortMap<E> | undefined,
): { readonly order: QuerySortDirection; readonly project?: string } | undefined {
  const text = sort?.$text;
  if (text === undefined) {
    return undefined;
  }
  return isRecord(text) ? { order: text.$order ?? 'desc', project: text.$project } : { order: text };
}

/**
 * The search a `$sort` by `$text` ranks by: the one at the root of the same query's `$where`. A nested or
 * negated one has no score to order by, and MongoDB scores only the one `$text` it allows.
 */
export function rankedTextSearch<E>(where: QueryWhere<E> | undefined): QueryTextSearchOptions<E> {
  if (!where?.$text) {
    throw new UqlUsageError('$sort by $text ranks by the $text at the root of $where, which this query has none of');
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
    return fulltext[0].entries.flatMap((entry) => entry.column ?? []);
  }
  const name = entityName(meta);
  const declared = fulltext.length
    ? `${fulltext.length} fulltext indexes to choose from`
    : 'no fulltext index to search';
  throw new UqlUsageError(
    `$text on '${name}' names no $fields, and '${name}' declares ${declared}. Name them with $fields.`,
  );
}
