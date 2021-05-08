import { PropertyOptions } from '../../type';
import { defineId } from './definition';

export function Id<E>(opts?: PropertyOptions) {
  return (target: object, prop: string): void => {
    const E = target.constructor as { new (): E };
    defineId(E, prop, opts);
  };
}
