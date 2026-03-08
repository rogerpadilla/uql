import type { FieldOptions, Type } from '../../type/index.js';
import { defineId } from './definition.js';

export function Id<E>(opts: FieldOptions = {}) {
  return (target: object, key: string): void => {
    const entity = target.constructor as Type<E>;
    defineId(entity, key, opts);
  };
}
