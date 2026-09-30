import { soleIdOf } from '../entity/metadata/definition.js';
import type {
  EntityId,
  EntityMeta,
  FieldKey,
  Query,
  QueryConflictPaths,
  QuerySearch,
  QuerySortDirection,
  QuerySortMap,
  QueryWhere,
  QueryWhereArray,
} from '../type/index.js';
import { entityName, isScalarId, isWhereMap } from './object.util.js';
import { UqlUsageError } from './uqlError.js';

/**
 * Maps each of `keys` to `true`, the shape of a `$select` or conflict paths. This and the builders below hold
 * the casts generic code needs to build a statement: the compiler types these maps per entity, so it does not
 * accept a key read at run time as one of their keys.
 */
export function keySet<E>(keys: readonly FieldKey<E>[]): QueryConflictPaths<E> {
  return Object.fromEntries(keys.map((key) => [key, true])) as QueryConflictPaths<E>;
}

/** `where` (or an empty `$where`) with `key` also set to `value`. Keys in one map combine with `AND`. */
export function whereWith<E>(key: FieldKey<E>, value: unknown, where?: QueryWhere<E>): QueryWhere<E> {
  return { ...where, [key]: value } as QueryWhere<E>;
}

export function whereEach<E>(keys: readonly FieldKey<E>[], valueOf: (key: FieldKey<E>) => unknown): QueryWhere<E> {
  return Object.fromEntries(keys.map((key) => [key, valueOf(key)])) as QueryWhere<E>;
}

export function whereAnyOf<E>(clauses: QueryWhereArray<E>): QueryWhere<E> {
  return { $or: clauses } as QueryWhere<E>;
}

/** A `$sort` from `[key, direction]` pairs, sorting by the keys in the order given. */
export function sortOf<E>(entries: readonly (readonly [FieldKey<E>, QuerySortDirection])[]): QuerySortMap<E> {
  return Object.fromEntries(entries) as QuerySortMap<E>;
}

/**
 * Appends `clauses` to the `$and` of `where`. Merging them into its keys instead could lose one to a key of
 * the same name, such as a second `$or`.
 */
export function whereAnd<E>(where: QueryWhere<E> | undefined, clauses: QueryWhereArray<E>): QueryWhere<E> {
  return { ...where, $and: [...(where?.$and ?? []), ...clauses] } as QueryWhere<E>;
}

/** `q` selecting only the id. A write passes it to its backend's read builder to find the rows it will act on. */
export function idOnlyQuery<E>(meta: EntityMeta<E>, q: QuerySearch<E>): Query<E> {
  return { ...q, $select: keySet(meta.ids) };
}

/**
 * A `$where` selecting rows by key. A bare value matches the single key column (refused on a composite key),
 * a composite key's map is already a `$where`, and a list becomes an `IN` of bare values or an `$or` of maps.
 */
export function whereIds<E>(meta: EntityMeta<E>, ids: EntityId<E> | EntityId<E>[]): QueryWhere<E> {
  if (Array.isArray(ids) ? ids.every(isScalarId) : isScalarId(ids)) {
    return whereWith(soleIdOf(meta, 'addressing by a bare id value'), ids);
  }
  return (Array.isArray(ids) ? { $or: ids } : ids) as QueryWhere<E>;
}

/**
 * Throws on a `$where` that is not a map. Untyped JS and parsed JSON can still pass an id or a list of ids,
 * and a scalar read as a map has no keys, so the statement would match every row.
 */
export function assertWhere<E>(meta: EntityMeta<E>, where: unknown): void {
  if (!isWhereMap(where)) {
    throw new UqlUsageError(`$where on '${entityName(meta)}' must be a map of conditions, such as { id: 1 }`);
  }
}

/** A parsed `$sort` direction: whether it is descending, and where it puts nulls if it says. */
export type SortDirection = { readonly desc: boolean; readonly nulls?: 'first' | 'last' };

const SORT_DIRECTIONS: ReadonlyMap<unknown, SortDirection> = new Map<QuerySortDirection, SortDirection>([
  [1, { desc: false }],
  ['asc', { desc: false }],
  [-1, { desc: true }],
  ['desc', { desc: true }],
  ['ascNullsFirst', { desc: false, nulls: 'first' }],
  ['ascNullsLast', { desc: false, nulls: 'last' }],
  ['descNullsFirst', { desc: true, nulls: 'first' }],
  ['descNullsLast', { desc: true, nulls: 'last' }],
]);

/**
 * Parses a `$sort` direction. Every backend and the page cursor share this one parser, so a sort order and
 * the cursor condition that pages through it cannot disagree.
 */
export function parseSortDirection(value: unknown): SortDirection {
  const direction = SORT_DIRECTIONS.get(value);
  if (!direction) {
    throw new UqlUsageError(`unknown sort direction: ${String(value)}`);
  }
  return direction;
}
