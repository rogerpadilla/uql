import type { EntityOptions, Type } from '../../type/index.js';
import { defineEntity } from '../metadata/definition.js';

export function Entity<E>(opts?: EntityOptions<E>) {
  return (entity: Type<E>): void => {
    defineEntity(entity, opts);
  };
}
