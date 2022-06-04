import { FieldOptions, Type } from '@uql/core/type';
import { defineField } from './definition.js';

export function Field<E>(opts?: FieldOptions) {
  return (target: object, key: string): void => {
    const entity = target.constructor as Type<E>;
    defineField(entity, key, opts);
  };
}
