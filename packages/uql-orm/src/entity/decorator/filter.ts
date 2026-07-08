import type { FilterOptions, Type } from '../../type/index.js';
import { defineFilter } from '../metadata/definition.js';

/**
 * Registers a named, default-on `$where` filter on the entity, applied to every query
 * unless bypassed via `QueryOptions.filters`.
 * @example `@Filter('active', { condition: { status: 'active' }, default: false })`
 */
export function Filter<E>(name: string, opts: FilterOptions<E>) {
  return (entity: Type<E>): void => {
    defineFilter(entity, name, opts);
  };
}
