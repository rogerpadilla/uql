import { Type } from '@uql/core/type';
import { BaseClientRepository } from './querier/baseClientRepository';
import { HttpQuerier } from './querier/httpQuerier';
import { ClientQuerier, UqlClientOptions } from './type';

let options: UqlClientOptions;

const defaultOptions: Partial<UqlClientOptions> = {
  querierPool: {
    getQuerier: () => new HttpQuerier('/api'),
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

export function getRepository<E>(entity: Type<E>, querier?: ClientQuerier) {
  const finalQuerier = querier ?? getQuerier();
  return new BaseClientRepository(entity, finalQuerier);
}
