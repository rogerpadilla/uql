import { PropertyOptions } from 'uql/type';
import { defineProperty } from './definition';

export function Property<T>(opts?: PropertyOptions) {
  return (target: object, prop: string): void => {
    const type = target.constructor as { new (): T };
    defineProperty(type, prop, opts);
  };
}
