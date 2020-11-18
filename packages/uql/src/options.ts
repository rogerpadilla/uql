import { UqlOptions } from './type';
import { clearRepositoriesCache } from './repository/container';

let options: UqlOptions;

export function setOptions(opts: UqlOptions) {
  options = { logger: console.log, ...opts };
  clearRepositoriesCache();
}

export function getOptions() {
  return { ...options };
}
