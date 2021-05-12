import { PropertyOptions, Type } from '../../type';
import { defineProperty } from './definition';

export function Property<E>(opts?: PropertyOptions) {
  return (target: object, prop: string): void => {
    const entity = target.constructor as Type<E>;
    defineProperty(entity, prop, opts);
  };
}
