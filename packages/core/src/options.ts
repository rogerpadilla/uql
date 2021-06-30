import { BaseRepository } from './querier/baseRepository';
import { Querier, QuerierPool, Repository, Type, UqlOptions } from './type';

let options: UqlOptions;
const defaultOptions = { logger: console.log } as const as UqlOptions;

export function setOptions(opts: UqlOptions): void {
  options = { ...defaultOptions, ...opts };
}

export function getOptions(): UqlOptions {
  return options ?? defaultOptions;
}

export function getQuerierPool(): QuerierPool {
  const options = getOptions();
  if (!options.querierPool) {
    throw new TypeError(`'querierPool' has to be passed via 'setOptions'`);
  }
  return options.querierPool;
}

export function getQuerier(): Promise<Querier> {
  return getQuerierPool().getQuerier();
}

export function getRepository<E>(entity: Type<E>, querier: Querier): Repository<E> {
  return new BaseRepository(entity, querier);
}

export function log(message: any, ...args: any[]) {
  if (options?.logging) {
    options.logger(message, ...args);
  }
}

export function setLogging(logging: boolean): void {
  options = { ...defaultOptions, logging };
}

export function isLogging(): boolean {
  return options?.logging;
}
