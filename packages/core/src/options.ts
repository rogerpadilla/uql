import { UqlOptions } from './type';

let options: UqlOptions;

export function setOptions(opts: UqlOptions) {
  options = { logger: console.log, ...opts };
}

export function getOptions() {
  if (!options) {
    throw new TypeError('options has to be set');
  }
  return { ...options };
}

export function getQuerierPool() {
  const options = getOptions();
  return options.querierPool;
}

export function getQuerier() {
  const querierPool = getQuerierPool();
  return querierPool.getQuerier();
}
