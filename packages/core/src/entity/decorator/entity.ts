import { EntityOptions, Type } from '../../type';
import { defineEntity } from './definition';

export function Entity<E>(opts?: EntityOptions) {
  return (entity: Type<E>): void => {
    defineEntity(entity, opts);
  };
}
