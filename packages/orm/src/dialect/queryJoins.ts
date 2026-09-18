import { getMeta, relationOf } from '../entity/index.js';
import type {
  EntityMeta,
  Query,
  QueryGroupMap,
  QueryPopulate,
  QuerySortMap,
  RelationKey,
  RelationMeta,
  RelationQuery,
  Type,
} from '../type/index.js';
import { getKeys, getRelationRequestSummary, isRecord, isToManyRelation, parseRelationAtKey } from '../util/index.js';

/**
 * One relation a statement joins, keyed by the alias its columns are addressed by (`tax`,
 * `tax.category`). `projected` tells a `$populate` join, whose columns are selected, from one only
 * `$sort` needs - which joins the same way, filters included, but adds nothing to the result.
 */
export type QueryJoin = {
  /** The relation key on its parent, which is how MongoDB names the field a `$lookup` adds. */
  readonly key: string;
  /** Dotted path from the queried entity, which is what a joined row's columns answer under. */
  readonly path: string;
  /** The alias the statement reads it through: its path, unless another table of the statement took it. */
  readonly alias: string;
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
 * What the statement joins, from `$populate` and from a `$sort` by a to-one relation's field, so the
 * columns, the `ORDER BY` and the lock agree. `claimAlias` names each join's table, parents first.
 */
export function resolveQueryJoins<E>(
  meta: EntityMeta<E>,
  q: Query<E>,
  claimAlias: (path: string) => string = (path) => path,
): QueryJoins {
  if (!q.$populate && !q.$sort) {
    return NO_JOINS;
  }
  const joins = new Map<string, QueryJoin>();
  addPopulateJoins(joins, claimAlias, meta, q.$populate);
  addPathJoins(joins, claimAlias, meta, q.$sort);
  return joins;
}

/** What an aggregate joins: each to-one relation a `$group` path passes through. */
export function resolveGroupJoins<E>(
  meta: EntityMeta<E>,
  group: QueryGroupMap<E> | undefined,
  claimAlias: (path: string) => string = (path) => path,
): QueryJoins {
  const joins = new Map<string, QueryJoin>();
  for (const ref of Object.values(group ?? {})) {
    if (isRecord(ref)) {
      addPathJoins(joins, claimAlias, meta, ref);
    }
  }
  return joins;
}

/** The field a grouped `path` reads, and the join it reads it through: none for the entity's own. */
export function groupPathField(
  joins: QueryJoins,
  path: readonly string[],
): { readonly key: string; readonly join: QueryJoin | undefined } {
  const key = path[path.length - 1];
  if (path.length === 1) {
    return { key, join: undefined };
  }
  const join = joins.get(path.slice(0, -1).join('.'));
  if (!join) {
    throw new TypeError(
      `cannot $group by '${path.join('.')}': only a to-one relation's field groups, since a to-many multiplies the rows it joins`,
    );
  }
  return { key, join };
}

/**
 * Whether a join drops parents that have no match, which is the one thing a join does to *how many*
 * rows a read returns rather than how wide they are. A count that skips the joins has to be told, or
 * it counts the parents the read will never hand back.
 */
export function hasRequiredJoin<E>(meta: EntityMeta<E>, q: Query<E>): boolean {
  for (const join of resolveQueryJoins(meta, q).values()) {
    if (join.required) {
      return true;
    }
  }
  return false;
}

/** Whether a statement aggregates a relation's rows: a to-many off its own row, or off a row it joins. */
export function aggregatesRelations<E>(meta: EntityMeta<E>, q: Query<E>): boolean {
  if (getRelationRequestSummary(meta, q.$populate).toManyKeys.length) {
    return true;
  }
  for (const join of resolveQueryJoins(meta, q).values()) {
    if (getRelationRequestSummary(join.meta, join.query.$populate).toManyKeys.length) {
      return true;
    }
  }
  return false;
}

function addJoin(
  joins: Map<string, QueryJoin>,
  claimAlias: (path: string) => string,
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
    key,
    path,
    alias: claimAlias(path),
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
  claimAlias: (path: string) => string,
  meta: EntityMeta<E>,
  populate: QueryPopulate<E> | undefined,
  parent?: QueryJoin,
): void {
  for (const key of getRelationRequestSummary(meta, populate).joinableKeys) {
    const relation = relationOf(meta, key);
    const { query, required } = parseRelationAtKey(key, populate);
    const join = addJoin(joins, claimAlias, parent, key, relation, query, required, true);
    addPopulateJoins(joins, claimAlias, join.meta, query.$populate, join);
  }
}

/** The to-one relations a nested map of fields passes through, a `$sort` or a `$group` path, as joins adding no columns. */
function addPathJoins<E>(
  joins: Map<string, QueryJoin>,
  claimAlias: (path: string) => string,
  meta: EntityMeta<E>,
  map: Readonly<Record<string, unknown>> | undefined,
  parent?: QueryJoin,
): void {
  if (!map) {
    return;
  }
  for (const key of getKeys(map)) {
    const relation = meta.relations[key as RelationKey<E>];
    const value = map[key];
    // A to-many, or a value that is not a map of the relation's own fields, cannot be joined and is
    // reported where the statement names it - the one place that knows how to.
    if (!relation || isToManyRelation(relation) || !isSortMap(value)) {
      continue;
    }
    const join = addJoin(joins, claimAlias, parent, key, relation, {}, false, false);
    // `E` stated: inferred from the nested map, it lands on the nested relation's target.
    addPathJoins<object>(joins, claimAlias, join.meta, value, join);
  }
}

/** The join a sort may address at `path` with the relation's own sort map, or why it may not; `unjoinable` is the dialect's remedy. */
export function resolveSortableJoin(
  relation: RelationMeta,
  path: string,
  value: unknown,
  joins: QueryJoins,
  unjoinable: string,
): { readonly join: QueryJoin; readonly sort: QuerySortMap<object> } {
  if (isToManyRelation(relation)) {
    throw new TypeError(
      `cannot $sort by '${path}': a parent has many of them, so there is no single value to order by. Sort the relation's own rows inside $populate instead.`,
    );
  }
  if (!isSortMap(value)) {
    throw new TypeError(`$sort by relation '${path}' expects a map of its fields, got ${String(value)}`);
  }
  const join = joins.get(path);
  if (!join) {
    throw new TypeError(unjoinable);
  }
  return { join, sort: value };
}

/** A nested map of fields, as opposed to a `$sort` direction or vector search, or a `$group` field's `true`. */
function isSortMap(value: unknown): value is QuerySortMap<object> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !('$vector' in value);
}
