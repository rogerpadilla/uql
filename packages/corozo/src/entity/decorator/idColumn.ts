import { IdColumnOptions } from './type';
import { defineIdColumn } from './definition';

export function IdColumn<T>(opts?: IdColumnOptions<T>) {
  return (target: object, prop: string): void => {
    const type = target.constructor as { new (): T };
    defineIdColumn(type, prop, opts);
  };
}
