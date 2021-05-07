import { EntityOptions } from '../../type';
import { define } from './definition';

export function Entity(opts?: EntityOptions) {
  return (type: { new (): object }): void => {
    define(type, opts);
  };
}
