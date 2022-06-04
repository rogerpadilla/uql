import { FieldOptions, Type } from '@uql/core/type';
import { defineId } from './definition.js';

export function Id<E>(opts?: Omit<FieldOptions, 'isId'>) {
  return (target: object, key: string): void => {
    const entity = target.constructor as Type<E>;
    defineId(entity, key, opts);
  };
}
