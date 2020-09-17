import { ColumnOptions } from './type';
import { defineId } from './definition';

export function Id<T>(opts?: ColumnOptions<T>) {
  return (target: object, prop: string): void => {
    const type = target.constructor as { new (): T };
    defineId(type, prop, opts);
  };
}
