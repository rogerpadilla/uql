import { getContext, UqlSecurityError } from '../context/context.js';
import {
  type CascadeType,
  type EntityMeta,
  type FieldKey,
  type FieldOptions,
  type FilterOnMissing,
  type IdValue,
  isQueryAggregateOp,
  type MongoId,
  type OnFieldCallback,
  type QueryAggMap,
  type QueryAggregateOp,
  type QueryExclude,
  type QueryGroupMap,
  type QueryOptions,
  QueryRaw,
  type QuerySelect,
  type QuerySortMap,
  type QueryVectorSearch,
  type QueryWhere,
  type QueryWhereMap,
  type RelationKey,
  type UqlContext,
} from '../type/index.js';
import { getFieldKeys, getKeys, hasKeys, someKey } from './object.util.js';

export type CallbackKey = keyof Pick<FieldOptions, 'onInsert' | 'onUpdate'>;

export function filterFieldKeys<E>(meta: EntityMeta<E>, payload: E, callbackKey: CallbackKey): FieldKey<E>[] {
  return getKeys(payload as object).filter((key) => {
    const fieldOpts = meta.fields[key];
    return fieldOpts && !fieldOpts.virtual && (callbackKey !== 'onUpdate' || fieldOpts.updatable !== false);
  }) as FieldKey<E>[];
}

/** Whether `key` is a real, non-virtual field that `record` provides a defined value for. */
function isInsertableField<E>(meta: EntityMeta<E>, record: E, key: FieldKey<E>): boolean {
  const field = meta.fields[key];
  return !!field && !field.virtual && record[key] !== undefined;
}

/** Appends `record`'s not-yet-`seen` insertable keys (real, non-virtual, defined value) to `keys`. */
function addInsertFieldKeys<E>(meta: EntityMeta<E>, record: E, seen: Set<FieldKey<E>>, keys: FieldKey<E>[]): void {
  for (const key of getKeys(record as object) as FieldKey<E>[]) {
    if (!seen.has(key) && isInsertableField(meta, record, key)) {
      seen.add(key);
      keys.push(key);
    }
  }
}

/**
 * Resolves the columns of an INSERT statement: the union of the persistable fields provided by
 * any record (in first-seen order), plus every `onInsert` field. Records missing one of these
 * columns insert its database default.
 *
 * The column list is seeded from the first record, then extended only by records that introduce a
 * new column. A homogeneous batch (every record the same shape, the common case) is detected with
 * {@link someKey}, which walks a record without allocating a key array, so only the rare record that
 * actually adds a column pays for a full rescan.
 *
 * `onInsert` fields are always included so the column set is stable whether or not the caller
 * has run {@link fillOnFields} first (it stamps them on every record, but the querier's
 * chunk-size estimate inspects the raw payload).
 */
export function getInsertFieldKeys<E>(meta: EntityMeta<E>, payloads: E[]): FieldKey<E>[] {
  const seen = new Set<FieldKey<E>>();
  const keys: FieldKey<E>[] = [];
  addInsertFieldKeys(meta, payloads[0], seen, keys);
  for (let i = 1; i < payloads.length; i++) {
    const record = payloads[i]!;
    if (
      someKey(
        record as object,
        (key) => !seen.has(key as FieldKey<E>) && isInsertableField(meta, record, key as FieldKey<E>),
      )
    ) {
      addInsertFieldKeys(meta, record, seen, keys);
    }
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

export function fillOnFields<E>(meta: EntityMeta<E>, payload: E | E[], callbackKey: CallbackKey): E[] {
  const payloads = Array.isArray(payload) ? payload : [payload];
  const keys = getKeys(meta.fields).filter((key) => meta.fields[key]![callbackKey]!) as FieldKey<E>[];
  if (keys.length === 0) {
    return payloads;
  }
  for (const it of payloads) {
    for (const key of keys) {
      if (it[key] === undefined) {
        it[key] = getFieldCallbackValue(meta.fields[key]![callbackKey]!) as E[typeof key];
      }
    }
  }
  return payloads;
}

export function filterPersistableRelationKeys<E>(
  meta: EntityMeta<E>,
  payload: E,
  action: CascadeType,
): RelationKey<E>[] {
  const keys = getKeys(payload as object);
  return keys.filter((key) => {
    const relOpts = meta.relations[key];
    return relOpts && isCascadable(action, relOpts.cascade);
  }) as RelationKey<E>[];
}

export function isCascadable(action: CascadeType, configuration?: boolean | CascadeType): boolean {
  if (typeof configuration === 'boolean') {
    return configuration;
  }
  return configuration === action;
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
        positiveFields.push(key as FieldKey<E>);
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

export function buildSortMap<E>(sort: QuerySortMap<E> | undefined): QuerySortMap<E> {
  return (sort ?? {}) as QuerySortMap<E>;
}

/** Type guard: checks whether a sort value is a vector similarity search. */
export function isVectorSearch(value: unknown): value is QueryVectorSearch {
  return value !== null && typeof value === 'object' && '$vector' in (value as Record<string, unknown>);
}

export function augmentWhere<E>(
  meta: EntityMeta<E>,
  target: QueryWhere<E> = {},
  source: QueryWhere<E> = {},
): QueryWhere<E> {
  const targetComparison = buildQueryWhereAsMap(meta, target);
  const sourceComparison = buildQueryWhereAsMap(meta, source);
  return {
    ...targetComparison,
    ...sourceComparison,
  };
}

/**
 * Normalizes any `$where` shape (id, id[], raw, or map) to a `QueryWhereMap`. Read-only: for a map
 * input it returns that same object by reference (no copy), so callers must not mutate the result -
 * {@link applyFilters} and {@link augmentWhere} return new objects instead.
 */
export function buildQueryWhereAsMap<E>(meta: EntityMeta<E>, filter: QueryWhere<E> = {}): QueryWhereMap<E> {
  if (filter instanceof QueryRaw) {
    return { $and: [filter] } as QueryWhereMap<E>;
  }
  if (isIdValue(filter)) {
    return {
      [meta.id]: filter,
    } as QueryWhereMap<E>;
  }
  return filter as QueryWhereMap<E>;
}

/** Returns a `QueryOptions.filters` value with the built-in soft-delete filter disabled (used by hard delete). */
export function withoutSoftDeleteFilter(filters: QueryOptions['filters']): QueryOptions['filters'] {
  return filters === false ? false : { ...filters, softDelete: false };
}

/**
 * Returns a new `$where` map with every active entity filter's condition merged in, resolving
 * parameterized conditions against the explicit or ambient {@link UqlContext}. Never mutates the input.
 *
 * Convenience filters are active by default (unless `opts.filters === false` or bypassed by name), and
 * their keys are applied only when absent from the map, so an explicit `$where` on that key opts out.
 *
 * `security` filters are always active (bypass is ignored) and AND-merged, so a client `$where` on the
 * same field can't override them. A security condition that returns `undefined` fails the query closed
 * (throws {@link UqlSecurityError}) unless its `onMissing` is `skip`; one that returns an empty object
 * (`{}`) resolved to "no restriction" and adds nothing - the escape hatch for trusted cross-tenant
 * work (e.g. a maintenance job running under a `system` context).
 */
export function applyFilters<E>(
  meta: EntityMeta<E>,
  whereMap: QueryWhereMap<E>,
  opts?: QueryOptions,
): QueryWhereMap<E> {
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

    const raw = filter.condition;
    const condition =
      typeof raw === 'function' ? (raw as (c: UqlContext | undefined) => QueryWhere<E> | undefined)(context) : raw;
    if (condition === undefined) {
      const onMissing: FilterOnMissing = filter.onMissing ?? (filter.security ? 'throw' : 'skip');
      if (onMissing === 'throw') {
        throw new UqlSecurityError(`filter '${name}' on '${meta.name ?? ''}' could not resolve (missing context)`);
      }
      continue;
    }

    const conditionMap = buildQueryWhereAsMap(meta, condition) as Record<string, unknown>;
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

  return result as QueryWhereMap<E>;
}

function isIdValue<E>(filter: QueryWhere<E>): filter is IdValue<E> | IdValue<E>[] {
  const type = typeof filter;
  return (
    type === 'string' ||
    type === 'number' ||
    type === 'bigint' ||
    typeof (filter as MongoId).toHexString === 'function' ||
    Array.isArray(filter)
  );
}

/**
 * Parsed entry from a `$group` map - either a raw group key or an aggregate function call.
 */
export type ParsedGroupEntry =
  | { readonly kind: 'key'; readonly alias: string }
  | { readonly kind: 'fn'; readonly alias: string; readonly op: QueryAggregateOp; readonly fieldRef: string };

/**
 * Parse the `$group` (grouped columns) and `$agg` (computed aggregates) maps into structured
 * entries consumable by any dialect. Grouped columns come first, then computed columns.
 */
export function parseGroupMap<E>(group?: QueryGroupMap<E>, agg?: QueryAggMap<E>): ParsedGroupEntry[] {
  const entries: ParsedGroupEntry[] = [];
  const groupMap = group ?? {};
  for (const alias of getKeys(groupMap)) {
    if (groupMap[alias]) {
      entries.push({ kind: 'key', alias });
    }
  }
  if (!agg) {
    return entries;
  }
  for (const alias of getKeys(agg)) {
    const fnEntry = agg[alias];
    const key = getKeys(fnEntry)[0];
    if (!isQueryAggregateOp(key)) {
      throw TypeError(`unsupported aggregate operator: ${key}`);
    }
    entries.push({ kind: 'fn', alias, op: key, fieldRef: fnEntry[key] });
  }
  return entries;
}
