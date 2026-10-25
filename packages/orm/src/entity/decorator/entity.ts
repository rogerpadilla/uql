import type { BrandsNameFields, EntityOptions, AbstractType } from '../../type/index.js';
import { registerEntity } from '../metadata/definition.js';
import { drainRegistrations } from './bag.js';

/**
 * Marks a class as an entity and finalizes its metadata, draining `context.metadata`: the class gets
 * `Symbol.metadata` only after its decorators return. `abstract: true` marks a base that is never a table.
 */
export function Entity<E>(opts?: NoInfer<EntityOptions<E>>) {
  return (entity: AbstractType<E> & BrandsNameFields<E>, context?: ClassDecoratorContext): void => {
    registerEntity(entity, opts, drainRegistrations(context?.metadata));
  };
}
