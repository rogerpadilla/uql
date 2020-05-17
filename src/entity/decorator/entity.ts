import { defineEntity } from './storage';
import { EntityProperties } from './type';

export function Entity(args: EntityProperties = {}) {
  return (constructor: Function) => {
    const type = constructor as { new (): object };
    defineEntity(type, args);
  };
}
