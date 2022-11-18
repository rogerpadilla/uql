import { HttpQuerier } from './querier/httpQuerier.js';
import { ClientQuerier } from './type';
import { ClientQuerierPool } from './type/clientQuerierPool.js';

let defaultPool: ClientQuerierPool = {
  getQuerier: () => new HttpQuerier('/api'),
};

export function setQuerierPool<T extends ClientQuerierPool>(pool: T) {
  defaultPool = pool;
}

export function getQuerierPool(): ClientQuerierPool {
  return defaultPool;
}

export function getQuerier(): ClientQuerier {
  return getQuerierPool().getQuerier();
}
