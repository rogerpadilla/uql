import type { EntityMeta, Query, QueryPopulate, QuerySelect, RelationKey } from '../type/index.js';
import { getKeys } from './object.util.js';

export type RelationRequestSummary<E> = {
  readonly requestedKeys: RelationKey<E>[];
  readonly joinableKeys: RelationKey<E>[];
  readonly toManyKeys: RelationKey<E>[];
};

export function getRelationRequestSummary<E>(
  meta: EntityMeta<E>,
  populate?: QueryPopulate<E>,
): RelationRequestSummary<E> {
  const requestedKeys: RelationKey<E>[] = [];
  const joinableKeys: RelationKey<E>[] = [];
  const toManyKeys: RelationKey<E>[] = [];

  if (!populate) return { requestedKeys, joinableKeys, toManyKeys };

  for (const key of getKeys(populate)) {
    if (!populate[key]) continue;

    const relOpts = meta.relations[key];
    if (!relOpts) continue;

    requestedKeys.push(key);

    if (relOpts.cardinality === '1m' || relOpts.cardinality === 'mm') {
      toManyKeys.push(key);
    } else {
      joinableKeys.push(key);
    }
  }

  return { requestedKeys, joinableKeys, toManyKeys };
}

/** True when `$populate` includes at least one relation key. */
export function isPopulatingRelations<E>(meta: EntityMeta<E>, populate?: QueryPopulate<E>): boolean {
  if (!populate) return false;
  return getKeys(populate).some((key) => populate[key] && key in meta.relations);
}

export type RelationQuery<E extends object = object> = Query<E> & { $required?: boolean };

// Keep in sync with nested keys allowed on `Query` / relation options (see `type/query.ts`).
const RELATION_QUERY_BOOLEAN_KEYS = new Set(['$distinct', '$required']);
const RELATION_QUERY_OBJECT_KEYS = new Set(['$select', '$populate', '$exclude', '$sort']);
const RELATION_QUERY_NUMBER_KEYS = new Set(['$limit', '$skip']);
const RELATION_QUERY_ALLOWED_KEYS = new Set([
  ...RELATION_QUERY_BOOLEAN_KEYS,
  ...RELATION_QUERY_OBJECT_KEYS,
  ...RELATION_QUERY_NUMBER_KEYS,
  '$where',
]);

export function getRelationQueryValue<E>(relKey: RelationKey<E>, populate?: QueryPopulate<E>): unknown {
  return populate?.[relKey];
}

export function isRelationQueryObject<E extends object = object>(value: unknown): value is RelationQuery<E> {
  if (!isRecord(value)) return false;
  return isValidRelationQueryShape(value);
}

export type ParsedRelationQuery<E extends object = object> = {
  query: RelationQuery<E>;
  required: boolean;
  /** Structured relation query object (recurse validation / nested semantics). */
  nested: boolean;
};

export function parseRelationQueryValue<E extends object = object>(value: unknown): ParsedRelationQuery<E> {
  if (isRelationQueryObject(value)) {
    return { query: value, required: value.$required === true, nested: true };
  }
  if (Array.isArray(value)) {
    const selectMap: QuerySelect<E> = {};
    for (const key of value) {
      selectMap[key as keyof QuerySelect<E>] = 1;
    }
    return { query: { $select: selectMap }, required: false, nested: false };
  }
  if (value !== undefined && value !== null && value !== true && value !== 1) {
    throw new TypeError(
      `Invalid relation query value '${String(value)}'. Expected true/1, relation query object, or relation $populate array.`,
    );
  }
  return { query: {} as RelationQuery<E>, required: false, nested: false };
}

/** Parses the relation payload for `relKey` */
export function parseRelationAtKey<E>(relKey: RelationKey<E>, populate?: QueryPopulate<E>): ParsedRelationQuery {
  return parseRelationQueryValue(getRelationQueryValue(relKey, populate));
}

export function forEachRequestedRelation<E extends object>(
  meta: EntityMeta<E>,
  populate: QueryPopulate<E> | undefined,
  fn: (relKey: RelationKey<E>, rawValue: unknown) => void,
): void {
  for (const relKey of getRelationRequestSummary(meta, populate).requestedKeys) {
    fn(relKey, getRelationQueryValue(relKey, populate));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isBooleanLikeValue(value: unknown): value is boolean | 0 | 1 {
  return value === true || value === false || value === 0 || value === 1;
}

function isValidRelationQueryShape(query: Record<string, unknown>): boolean {
  let hasKnownKey = false;
  for (const [key, value] of Object.entries(query)) {
    if (!RELATION_QUERY_ALLOWED_KEYS.has(key)) {
      return false;
    }
    hasKnownKey = true;
    if (RELATION_QUERY_BOOLEAN_KEYS.has(key) && !isBooleanLikeValue(value)) {
      return false;
    }
    if (RELATION_QUERY_OBJECT_KEYS.has(key) && !isRecord(value)) {
      return false;
    }
    if (RELATION_QUERY_NUMBER_KEYS.has(key) && (typeof value !== 'number' || !Number.isFinite(value))) {
      return false;
    }
    if (key === '$where' && !isRecord(value)) {
      return false;
    }
  }
  return hasKnownKey;
}
