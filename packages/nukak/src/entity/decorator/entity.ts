import { EntityOptions, Type } from '../../type';
import { defineEntity } from './definition.js';

export function Entity<E>(opts?: EntityOptions) {
  return (entity: Type<E>): void => {
    defineEntity(entity, opts);
  };
}
