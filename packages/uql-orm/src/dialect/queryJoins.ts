import { getMeta } from '../entity/index.js';
import type { EntityMeta, Query, QueryPopulate, QuerySortMap, RelationKey, RelationMeta, Type } from '../type/index.js';
import {
  getKeys,
  getRelationRequestSummary,
  isToManyRelation,
  parseRelationAtKey,
  type RelationQuery,
} from '../util/index.js';

/**
 * One relation a statement joins, keyed by the alias its columns are addressed by (`tax`,
 * `tax.category`). `projected` tells a `$populate` join, whose columns are selected, from one only
 * `$sort` needs - which joins the same way, filters included, but adds nothing to the result.
 */
export type QueryJoin = {
  readonly path: string;
  readonly entity: Type<object>;
  readonly meta: EntityMeta<object>;
  readonly relation: RelationMeta;
  readonly query: RelationQuery;
  readonly required: boolean;
  readonly projected: boolean;
  /** `undefined` at the first level, where the parent is the queried entity itself. */
  readonly parent: QueryJoin | undefined;
};

/**
 * Every relation a statement joins, in the order the joins are emitted. Flat rather than a tree: a
 * parent is always resolved before its children, so iterating it in order visits them the same way
 * recursion would, and looking an alias up - which is what `$sort` needs - is a plain `get`.
 */
export type QueryJoins = ReadonlyMap<string, QueryJoin>;

export const NO_JOINS: QueryJoins = new Map();

/** What rendering an `ORDER BY` needs beyond the map itself: where columns live, and what is joined. */
export type QuerySortOptions = {
  /** Alias the queried entity's own columns are qualified by, when the statement qualifies them. */
  readonly prefix?: string;
  readonly joins?: QueryJoins;
  readonly distinct?: boolean;
};

/**
 * What the statement joins, from the whole query rather than from `$populate` alone: ordering by a
 * related column needs that relation joined just as much as selecting it does. The two sources meet
 * here, so the columns, the `ORDER BY` and the row lock cannot disagree about what is in the
 * statement. `$sort` contributes to-one relations only; the rest is rejected where it is rendered.
 */
export function resolveQueryJoins<E>(meta: EntityMeta<E>, q: Query<E>): QueryJoins {
  if (!q.$populate && !q.$sort) {
    return NO_JOINS;
  }
  const joins = new Map<string, QueryJoin>();
  addPopulateJoins(joins, meta, q.$populate);
  addSortJoins(joins, meta, q.$sort);
  return joins;
}

function addJoin(
  joins: Map<string, QueryJoin>,
  parent: QueryJoin | undefined,
  key: string,
  relation: RelationMeta,
  query: RelationQuery,
  required: boolean,
  projected: boolean,
): QueryJoin {
  const path = parent ? `${parent.path}.${key}` : key;
  const existing = joins.get(path);
  // `$populate` runs first, so an already-joined relation keeps its columns and its `$required`
  // INNER join: sorting by it asks for nothing a populated join does not already provide.
  if (existing) {
    return existing;
  }
  const entity = relation.entity();
  const join: QueryJoin = {
    path,
    entity,
    meta: getMeta(entity),
    relation,
    query,
    required,
    projected,
    parent,
  };
  joins.set(path, join);
  return join;
}

function addPopulateJoins<E>(
  joins: Map<string, QueryJoin>,
  meta: EntityMeta<E>,
  populate: QueryPopulate<E> | undefined,
  parent?: QueryJoin,
): void {
  for (const key of getRelationRequestSummary(meta, populate).joinableKeys) {
    const relation = meta.relations[key];
    if (!relation) continue;
    const { query, required } = parseRelationAtKey(key, populate);
    const join = addJoin(joins, parent, key, relation, query, required, true);
    addPopulateJoins(joins, join.meta, query.$populate, join);
  }
}

function addSortJoins<E>(
  joins: Map<string, QueryJoin>,
  meta: EntityMeta<E>,
  sort: QuerySortMap<E> | undefined,
  parent?: QueryJoin,
): void {
  if (!sort) {
    return;
  }
  for (const key of getKeys(sort)) {
    const relation = meta.relations[key as RelationKey<E>];
    const value = sort[key as keyof QuerySortMap<E>];
    // A to-many, or a value that is not a map of the relation's own fields, cannot be joined and is
    // reported where the `ORDER BY` is rendered - the one place that knows how to name it.
    if (!relation || isToManyRelation(relation) || !isSortMap(value)) {
      continue;
    }
    const join = addJoin(joins, parent, key, relation, {}, false, false);
    addSortJoins(joins, join.meta, value, join);
  }
}

/**
 * A nested `$sort` map, as opposed to a direction or a vector search. Shared with the `ORDER BY`
 * renderer so what counts as a relation sort is decided once, not once per side.
 */
export function isSortMap(value: unknown): value is QuerySortMap<object> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !('$vector' in value);
}
