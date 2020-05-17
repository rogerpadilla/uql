import { defineColumn } from './storage';
import { ColumnProperties } from './type';

export function Column(args?: ColumnProperties) {
  return (target: object, prop: string) => {
    const type = target.constructor as { new (): object };
    defineColumn(type, prop, args);
  };
}
