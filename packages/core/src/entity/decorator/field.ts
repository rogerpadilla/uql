import { FieldOptions, Type } from '../../type/index';
import { defineField } from './definition';

export function Field<E>(opts?: FieldOptions) {
  return (target: object, key: string): void => {
    const entity = target.constructor as Type<E>;
    defineField(entity, key, opts);
  };
}
