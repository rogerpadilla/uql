import { BaseRepository } from './querier/baseRepository';
import { Logger, Querier, QuerierPool, Repository, Type, UqlOptions } from './type';

let options: UqlOptions;
const defaultOptions = { logger: console.log } as const as UqlOptions;

export function setOptions(opts: UqlOptions): void {
  options = { ...defaultOptions, ...opts };
}

export function getOptions(): UqlOptions {
  if (!options) {
    return { ...defaultOptions };
  }
  return { ...options };
}

export function getQuerierPool(): QuerierPool {
  const options = getOptions();
  if (!options.querierPool) {
    throw new Error(`'querierPool' has to be passed via 'setOptions'`);
  }
  return options.querierPool;
}

export function getQuerier(): Promise<Querier> {
  return getQuerierPool().getQuerier();
}

export function getRepository<E>(entity: Type<E>, querier: Querier): Repository<E> {
  return new BaseRepository(entity, querier);
}

export function getLogger(): Logger {
  return getOptions().logger;
}
