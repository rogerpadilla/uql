import { FieldOptions, Type } from '../../type/index';
import { defineId } from './definition';

export function Id<E>(opts?: Omit<FieldOptions, 'isId'>) {
  return (target: object, key: string): void => {
    const entity = target.constructor as Type<E>;
    defineId(entity, key, opts);
  };
}
