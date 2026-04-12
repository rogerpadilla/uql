import {
  type CascadeType,
  type EntityMeta,
  type FieldKey,
  type FieldOptions,
  type IdValue,
  type MongoId,
  type OnFieldCallback,
  type QueryAggregateOp,
  type QueryExclude,
  type QueryGroupMap,
  QueryRaw,
  type QuerySelect,
  type QuerySortMap,
  type QueryVectorSearch,
  type QueryWhere,
  type QueryWhereMap,
  type RelationKey,
} from '../type/index.js';
import { getFieldKeys, getKeys } from './object.util.js';

export type CallbackKey = keyof Pick<FieldOptions, 'onInsert' | 'onUpdate' | 'onDelete'>;

export function filterFieldKeys<E>(meta: EntityMeta<E>, payload: E, callbackKey: CallbackKey): FieldKey<E>[] {
  return (Object.keys(payload as object) as string[]).filter((key) => {
    const fieldOpts = meta.fields[key];
    return fieldOpts && !fieldOpts.virtual && (callbackKey !== 'onUpdate' || (fieldOpts.updatable ?? true));
  }) as FieldKey<E>[];
}

export function getFieldCallbackValue(val: OnFieldCallback) {
  return typeof val === 'function' ? val() : val;
}

export function fillOnFields<E>(meta: EntityMeta<E>, payload: E | E[], callbackKey: CallbackKey): E[] {
  const payloads = Array.isArray(payload) ? payload : [payload];
  const keys = getKeys(meta.fields).filter((key) => meta.fields[key]?.[callbackKey]) as FieldKey<E>[];
  return payloads.map((it) => {
    for (const key of keys) {
      if (it[key] === undefined) {
        it[key] = getFieldCallbackValue(meta.fields[key]![callbackKey]!) as E[typeof key];
      }
    }
    return it;
  });
}

export function filterPersistableRelationKeys<E>(
  meta: EntityMeta<E>,
  payload: E,
  action: CascadeType,
): RelationKey<E>[] {
  const keys = Object.keys(payload as object) as string[];
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
  const positiveFields: FieldKey<E>[] = [];
  const excludedFields = new Set<FieldKey<E>>();

  for (const [key, value] of Object.entries(select ?? {})) {
    if (!(key in meta.fields)) continue;
    if (value) {
      positiveFields.push(key as FieldKey<E>);
    } else {
      excludedFields.add(key as FieldKey<E>);
    }
  }

  for (const [key, value] of Object.entries(exclude ?? {})) {
    if (value && key in meta.fields) {
      excludedFields.add(key as FieldKey<E>);
    }
  }

  if (positiveFields.length) {
    return positiveFields;
  }

  return getFieldKeys(meta.fields).filter((it) => !excludedFields.has(it)) as FieldKey<E>[];
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

export function buildQueryWhereAsMap<E>(meta: EntityMeta<E>, filter: QueryWhere<E> = {}): QueryWhereMap<E> {
  if (filter instanceof QueryRaw) {
    return { $and: [filter] } as QueryWhereMap<E>;
  }
  if (isIdValue(filter)) {
    return {
      [meta.id!]: filter,
    } as QueryWhereMap<E>;
  }
  return filter as QueryWhereMap<E>;
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
 * Parsed entry from a `$group` map — either a raw group key or an aggregate function call.
 */
export type ParsedGroupEntry =
  | { readonly kind: 'key'; readonly alias: string }
  | { readonly kind: 'fn'; readonly alias: string; readonly op: QueryAggregateOp; readonly fieldRef: string };

/**
 * Parse a `QueryGroupMap` into structured entries consumable by any dialect.
 * Eliminates the duplicated `value === true` / `typeof value === 'object'` pattern.
 */
export function parseGroupMap<E>(group: QueryGroupMap<E>): ParsedGroupEntry[] {
  const entries: ParsedGroupEntry[] = [];
  for (const alias of getKeys(group) as string[]) {
    const value = (group as Record<string, unknown>)[alias];
    if (value === true) {
      entries.push({ kind: 'key', alias });
    } else if (value && typeof value === 'object') {
      const fnEntry = value as Record<string, string>;
      const op = getKeys(fnEntry)[0] as QueryAggregateOp;
      entries.push({ kind: 'fn', alias, op, fieldRef: fnEntry[op] });
    }
  }
  return entries;
}
