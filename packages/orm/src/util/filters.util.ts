import type { QueryOptions } from '../type/index.js';

/**
 * Options including soft-deleted rows, server-side only. To list only deleted ones over the wire, filter
 * the field: `{ $where: { deletedAt: { $ne: null } } }`.
 * @example `querier.findMany(User, {}, withDeleted())`
 */
export function withDeleted(): QueryOptions {
  return { filters: { softDelete: false } };
}
