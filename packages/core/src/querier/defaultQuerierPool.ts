import { getOptions } from '../options';

export function getQuerierPool() {
  const options = getOptions();
  if (!options.querierPool) {
    throw new Error(`'querierPool' has to be passed via 'setOptions'`);
  }
  return options.querierPool;
}

export function getQuerier() {
  const querierPool = getQuerierPool();
  return querierPool.getQuerier();
}
