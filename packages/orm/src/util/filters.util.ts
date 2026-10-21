import { type QueryOptions, SOFT_DELETE_FILTER } from '../type/index.js';

/**
 * `opts`, or none, reaching soft-deleted rows too, server-side only. To list only deleted ones over the wire,
 * filter the field: `{ $where: { deletedAt: { $ne: null } } }`.
 * @example `querier.findMany(User, {}, withDeleted())`
 */
export function withDeleted<O extends QueryOptions>(opts: O): O;
export function withDeleted(opts?: QueryOptions): QueryOptions;
export function withDeleted(opts: QueryOptions = {}): QueryOptions {
  const { filters } = opts;
  return { ...opts, filters: filters === false ? false : { ...filters, [SOFT_DELETE_FILTER]: false } };
}
