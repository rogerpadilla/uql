import { Querier, QuerierPool } from './type/index';

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

export function getDefaultQuerier(): Promise<Querier> {
  return defaultPool.getQuerier();
}
