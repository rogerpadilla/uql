import { UqlOptions } from './type';

let options: UqlOptions;

export function setOptions(opts: UqlOptions) {
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

export function getDatasourceOptions() {
  const { datasource } = getOptions();
  if (!datasource) {
    throw new TypeError('datasource options has to be specified');
  }
  return datasource;
}
