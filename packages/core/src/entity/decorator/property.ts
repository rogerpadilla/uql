import { PropertyOptions } from '../../type';
import { defineProperty } from './definition';

export function Property<E>(opts?: PropertyOptions) {
  return (target: object, prop: string): void => {
    const entity = target.constructor as { new (): E };
    defineProperty(entity, prop, opts);
  };
}
