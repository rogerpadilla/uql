import type { QueryOptions } from '../type/index.js';

/**
 * Query options that include soft-deleted rows in the result - disables the built-in `softDelete`
 * filter for this call. This is a server-side option: filter bypass is intentionally not serialized
 * over the wire. To list *only* trashed rows with a serializable query, constrain the field instead,
 * e.g. `querier.findMany(User, { $where: { deletedAt: { $ne: null } } })` - the filter steps aside
 * for any key you set in `$where`.
 * @example `querier.findMany(User, {}, withDeleted())`
 */
export function withDeleted(): QueryOptions {
  return { filters: { softDelete: false } };
}
