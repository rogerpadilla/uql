import { HttpQuerier } from './querier/httpQuerier.js';
import type { ClientQuerier, ClientQuerierPool } from './type/index.js';

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
