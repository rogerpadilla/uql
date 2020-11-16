import { EntityOptions } from 'uql/type';
import { defineEntity } from './definition';

export function Entity(opts?: EntityOptions) {
  return (type: { new (): object }): void => {
    defineEntity(type, opts);
  };
}
