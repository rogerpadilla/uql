import { IdOptions, Type } from '../../type';
import { defineId } from './definition';

export function Id<E>(opts?: IdOptions) {
  return (target: object, key: string): void => {
    const entity = target.constructor as Type<E>;
    defineId(entity, key, opts);
  };
}
