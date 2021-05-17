import { Type } from '@uql/core/type';
import { HttpQuerier } from './querier/httpQuerier';
import { UqlClientOptions } from './type';

let options: UqlClientOptions;

const defaultOptions: Partial<UqlClientOptions> = {
  querierPool: {
    getQuerier: () => Promise.resolve(new HttpQuerier('/api')),
  },
} as const;

export function setOptions(opts: UqlClientOptions) {
  options = { ...defaultOptions, ...opts };
}

export function getOptions() {
  if (!options) {
    return { ...defaultOptions };
  }
  return { ...options };
}

export function getQuerierPool() {
  return getOptions().querierPool;
}

export function getQuerier() {
  return getQuerierPool().getQuerier();
}

export function getRepository<E>(entity: Type<E>) {
  return getQuerier().then((querier) => querier.getRepository(entity));
}
