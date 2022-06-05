import { GenericRepository } from './repository/index';
import { Querier, QuerierPool, Repository, Type } from './type/index';

let defaultPool: QuerierPool;

export function setDefaultQuerierPool<T extends QuerierPool = QuerierPool>(pool: T): void {
  defaultPool = pool;
}

export function getDefaultQuerierPool(): QuerierPool {
  if (!defaultPool) {
    throw new TypeError('A default querier-pool has to be set first');
  }
  return defaultPool;
}

export function getQuerier(): Promise<Querier> {
  return defaultPool.getQuerier();
}

export function getRepository<E>(entity: Type<E>, querier: Querier): Repository<E> {
  return new GenericRepository(entity, querier);
}
