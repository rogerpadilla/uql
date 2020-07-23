import { defineEntity } from './definition';
import { EntityOptions } from './type';

export function Entity(opts?: EntityOptions) {
  return (type: { new (): object }): void => {
    defineEntity(type, opts);
  };
}
