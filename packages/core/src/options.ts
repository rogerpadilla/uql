import { UqlOptions } from './type';

let options: UqlOptions;

export function uql(opts: UqlOptions) {
  options = { logger: console.log, ...opts };
}

export function clearOptions() {
  options = undefined;
}

export function getOptions() {
  if (!options) {
    throw new TypeError('options has to be set');
  }
  return { ...options };
}
