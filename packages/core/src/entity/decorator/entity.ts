import { EntityOptions } from '../../type';
import { define } from './definition';

export function Entity(opts?: EntityOptions) {
  return (entity: { new (): object }): void => {
    define(entity, opts);
  };
}
