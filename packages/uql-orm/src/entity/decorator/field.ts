import type { FieldOptions, Type } from '../../type/index.js';
import { defineField } from '../metadata/definition.js';

export function Field<E>(opts?: FieldOptions) {
  return (target: object, key: string): void => {
    const entity = target.constructor as Type<E>;
    defineField(entity, key, opts);
  };
}
