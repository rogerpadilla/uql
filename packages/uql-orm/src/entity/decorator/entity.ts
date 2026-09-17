import type {
  EntityIndexColumnInput,
  EntityIndexOptions,
  EntityOptions,
  FilterName,
  FilterOptions,
  RefMap,
  Type,
} from '../../type/index.js';
import { applyMembers, defineEntity, defineFilter, defineIndex } from '../metadata/definition.js';
import { drainRegistrations } from './bag.js';

// The class-level decorators. Unlike the member ones they receive the class, so each is a direct call
// into the registry with no bag in between.

/**
 * Marks a class as an entity and finalizes its metadata, draining `context.metadata`: the class gets
 * `Symbol.metadata` only after its decorators return.
 */
export function Entity<E>(opts?: NoInfer<EntityOptions<E>>) {
  return (entity: Type<E>, context?: ClassDecoratorContext): void => {
    applyMembers(entity, drainRegistrations(context?.metadata));
    defineEntity(entity, opts);
  };
}

/**
 * Registers a named `$where` filter, applied to every query unless bypassed via `QueryOptions.filters`.
 *
 * @example `@Filter('active', { where: { status: 'active' }, default: false })`
 */
export function Filter<E, N extends string>(name: FilterName<N>, opts: FilterOptions<E>) {
  return (entity: Type<E>): void => {
    defineFilter(entity, name, opts);
  };
}

/**
 * Declares a composite index, its columns read off the entity's refs, so `@Index((user) => [user.nope])`
 * does not compile and a rename reaches every column. Stacks, so several may sit above one class.
 * @example `@Index((user) => [user.lastName, raw`lower(${user.email})`], { unique: true })`
 */
export function Index<E>(
  columns: (refs: RefMap<E>) => readonly EntityIndexColumnInput<E>[],
  options: EntityIndexOptions<E> = {},
) {
  return (entity: Type<E>): void => {
    defineIndex(entity, { ...options, columns });
  };
}
