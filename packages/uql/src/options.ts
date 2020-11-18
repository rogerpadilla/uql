import { UqlOptions } from 'uql/type';
import { clearRepositoriesCache } from './repository/container';

let options: UqlOptions;

export function init(opts: UqlOptions) {
  options = { logger: console.log, ...opts };
  clearRepositoriesCache();
}

export function getOptions() {
  return { ...options };
}

export function log(message: string, ...rest: any[]) {
  options.logger(message, ...rest);
}
