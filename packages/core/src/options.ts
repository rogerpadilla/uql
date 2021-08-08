import { BaseRepository } from '@uql/core/repository';
import { Querier, QuerierPool, Repository, Type, UqlOptions } from '@uql/core/type';

let options: UqlOptions;
const defaultOptions = {} as const as UqlOptions;

export function setOptions(opts: UqlOptions): void {
  options = { ...defaultOptions, ...opts };
}

export function getOptions(): UqlOptions {
  return options ?? { ...defaultOptions };
}

export function getQuerierPool(): QuerierPool {
  const options = getOptions();
  if (!options.querierPool) {
    throw TypeError(`'querierPool' has to be passed via 'setOptions'`);
  }
  return options.querierPool;
}

export function getQuerier(): Promise<Querier> {
  return getQuerierPool().getQuerier();
}

export function getRepository<E>(entity: Type<E>, querier: Querier): Repository<E> {
  return new BaseRepository(entity, querier);
}
