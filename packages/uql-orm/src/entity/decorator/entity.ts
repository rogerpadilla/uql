import type { EntityOptions, FieldKey, FilterOptions, IndexColumnInput, IndexOptions, Type } from '../../type/index.js';
import { applyMembers, defineEntity, defineFilter, defineIndex } from '../metadata/definition.js';
import { drainRegistrations } from './bag.js';

// The class-level decorators. Unlike the member ones they receive the class, so each is a direct call
// into the registry with no bag in between.

/**
 * Marks a class as an entity and finalizes its metadata.
 *
 * @remarks Takes the registrations from `context.metadata` rather than from the class. Member
 * decorators have already run by the time a class decorator does, but TypeScript defines
 * `Symbol.metadata` on the class *after* the class decorators return, so reading `entity[Symbol.metadata]`
 * here would find only what the base class left behind. `defineEntity` reads it off the class instead,
 * which is correct for the imperative path because it runs later still.
 */
export function Entity<E>(opts?: EntityOptions<E>) {
  return (entity: Type<E>, context?: ClassDecoratorContext): void => {
    applyMembers(entity, drainRegistrations(context?.metadata));
    defineEntity(entity, opts);
  };
}

/**
 * Registers a named `$where` filter, applied to every query unless bypassed via `QueryOptions.filters`.
 *
 * @example `@Filter('active', { condition: { status: 'active' }, default: false })`
 */
export function Filter<E>(name: string, opts: FilterOptions<E>) {
  return (entity: Type<E>): void => {
    defineFilter(entity, name, opts);
  };
}

/**
 * Declares a composite index. Stacks, so several may sit above one class.
 *
 * `E` is inferred from the class the returned decorator is applied to, which is what lets the column
 * names be checked against it: `@Index(['nope'])` does not compile.
 *
 * @example `@Index(['lastName', 'firstName'], { name: 'idx_users_fullname' })`
 * @example `@Index(['email'], { unique: true })`
 * @example `@Index(['status'], { where: "status = 'active'" })`
 */
export function Index<E>(columns: readonly IndexColumnInput<FieldKey<E>>[], options: IndexOptions = {}) {
  return (entity: Type<E>): void => {
    defineIndex(entity, { ...options, columns });
  };
}
