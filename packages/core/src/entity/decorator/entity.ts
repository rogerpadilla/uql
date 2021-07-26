import { EntityOptions, Type } from '@uql/core/type';
import { defineEntity } from './definition';

export function Entity<E>(opts?: EntityOptions) {
  return (entity: Type<E>): void => {
    defineEntity(entity, opts);
  };
}
