import { defineColumn } from './definition';
import { ColumnOptions } from './type';

export function Column<T>(opts?: ColumnOptions<T>) {
  return (target: object, prop: string): void => {
    const type = target.constructor as { new (): T };
    defineColumn(type, prop, opts);
  };
}
