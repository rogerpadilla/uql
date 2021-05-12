import { PropertyOptions, Type } from '../../type';
import { defineId } from './definition';

export function Id<E>(opts?: PropertyOptions) {
  return (target: object, prop: string): void => {
    const entity = target.constructor as Type<E>;
    defineId(entity, prop, opts);
  };
}
