import { ColumnOptions } from './type';
import { defineIdColumn } from './definition';

export function IdColumn<T>(opts?: ColumnOptions<T>) {
  return (target: object, prop: string): void => {
    const type = target.constructor as { new (): T };
    defineIdColumn(type, prop, opts);
  };
}
