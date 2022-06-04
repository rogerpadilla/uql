import { Type } from '@uql/core/type';
import { GenericClientRepository } from './querier/genericClientRepository.js';
import { HttpQuerier } from './querier/httpQuerier.js';
import { ClientQuerier, ClientRepository } from './type/index.js';
import { ClientQuerierPool } from './type/clientQuerierPool.js';

let defaultQuerierPool: ClientQuerierPool = {
  getQuerier: () => new HttpQuerier('/api'),
};

export function setDefaultQuerierPool<T extends ClientQuerierPool>(pool: T) {
  defaultQuerierPool = pool;
}

export function getDefaultQuerierPool(): ClientQuerierPool {
  return defaultQuerierPool;
}

export function getQuerier(): ClientQuerier {
  return getDefaultQuerierPool().getQuerier();
}

export function getRepository<E>(entity: Type<E>, querier = getQuerier()): ClientRepository<E> {
  return new GenericClientRepository(entity, querier);
}
