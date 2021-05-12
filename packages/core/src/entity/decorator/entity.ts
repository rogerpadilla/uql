import { EntityOptions, Type } from '../../type';
import { define } from './definition';

export function Entity<E>(opts?: EntityOptions) {
  return (entity: Type<E>): void => {
    define(entity, opts);
  };
}
