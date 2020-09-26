import { UqlOptions } from 'uql/type';
import { resetContainer } from './container';

let opts: UqlOptions;

export function initUql(conf: UqlOptions): void {
  resetContainer();
  opts = { ...conf };
}

export function getUqlOptions(): UqlOptions {
  return { ...opts };
}
