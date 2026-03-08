import type { Querier, QuerierPool } from './type/index.js';

let defaultPool: QuerierPool;

export function setQuerierPool<T extends QuerierPool = QuerierPool>(pool: T): void {
  defaultPool = pool;
}

export function getQuerierPool(): QuerierPool {
  if (!defaultPool) {
    throw new TypeError('A default querier-pool has to be set first');
  }
  return defaultPool;
}

export function getQuerier(): Promise<Querier> {
  return defaultPool.getQuerier();
}
