import { defineColumn } from './storage';
import { ColumnOptions } from './type';

export function Column<T>(opts?: ColumnOptions<T>) {
  return (target: object, prop: string) => {
    const type = target.constructor as { new (): T };
    defineColumn(type, prop, opts);
  };
}
