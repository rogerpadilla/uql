import { defineEntity } from './storage';
import { EntityOptions } from './type';

export function Entity(opts?: EntityOptions) {
  return (constructor: Function) => {
    const type = constructor as { new (): object };
    defineEntity(type, opts);
  };
}
