import { BaseRepository } from './querier/baseRepository';
import { Querier, Type, UqlOptions } from './type';

let options: UqlOptions;

const defaultOptions: Partial<UqlOptions> = { logger: console.log } as const;

export function setOptions(opts: UqlOptions) {
  options = { ...defaultOptions, ...opts };
}

export function getOptions() {
  if (!options) {
    return { ...defaultOptions };
  }
  return { ...options };
}

export function getQuerierPool() {
  const options = getOptions();
  if (!options.querierPool) {
    throw new Error(`'querierPool' has to be passed via 'setOptions'`);
  }
  return options.querierPool;
}

export function getQuerier() {
  return getQuerierPool().getQuerier();
}

export function getRepository<E>(entity: Type<E>, querier: Querier) {
  return new BaseRepository(entity, querier);
}

export function getLogger() {
  return getOptions().logger;
}
