import { getCorozoOptions } from '../config';
import { IsomorphicRepository, ClientRepository, ServerRepository } from './type';

let cache = new WeakMap<{ new (): any }, IsomorphicRepository<any>>();

function getIsomorphicRepository<T>(type: { new (): T }): IsomorphicRepository<T> {
  if (!cache.has(type)) {
    const conf = getCorozoOptions();
    if (!conf.defaultRepositoryClass) {
      throw new Error(
        `Either a generic repository or a specific repository (for the type ${type.name}) must be registered first`
      );
    }
    cache.set(type, new conf.defaultRepositoryClass(type));
  }
  return cache.get(type);
}

export function getClientRepository<T>(type: { new (): T }): ClientRepository<T> {
  return getIsomorphicRepository(type);
}

export function getServerRepository<T>(type: { new (): T }): ServerRepository<T> {
  return getIsomorphicRepository(type);
}

export function setCustomRepository<T>(type: { new (): T }, repository: IsomorphicRepository<T>) {
  cache.set(type, repository);
}

/**
 * Useful for unit-testing
 */
export function resetContainer() {
  cache = new WeakMap<{ new (): any }, IsomorphicRepository<any>>();
}
