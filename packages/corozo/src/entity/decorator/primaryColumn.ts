import { PrimaryColumnOptions } from './type';
import { definePrimaryColumn } from './definition';

export function PrimaryColumn<T>(opts?: PrimaryColumnOptions<T>) {
  return (target: object, prop: string): void => {
    const type = target.constructor as { new (): T };
    definePrimaryColumn(type, prop, opts);
  };
}
