import { EntityOptions, Type } from '../../type/index.js';
import { defineEntity } from './definition.js';

export function Entity<E>(opts?: EntityOptions) {
  return (entity: Type<E>): void => {
    defineEntity(entity, opts);
  };
}
