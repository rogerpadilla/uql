import { PropertyOptions } from 'uql/type';
import { defineId } from './definition';

export function Id<T>(opts?: PropertyOptions) {
  return (target: object, prop: string): void => {
    const type = target.constructor as { new (): T };
    defineId(type, prop, opts);
  };
}
