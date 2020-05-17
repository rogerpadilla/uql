import { PrimaryColumnProperties } from './type';
import { definePrimaryColumn } from './storage';

export function PrimaryColumn(args?: PrimaryColumnProperties) {
  return (target: object, prop: string) => {
    const type = target.constructor as { new (): object };
    definePrimaryColumn(type, prop, args);
  };
}
