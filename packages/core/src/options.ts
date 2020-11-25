import { UqlOptions } from './type';

let options: UqlOptions;

export function setOptions(opts: UqlOptions) {
  options = { logger: console.log, ...opts };
}

export function getOptions() {
  return { ...options };
}
