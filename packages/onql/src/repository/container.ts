import { getOnqlOptions } from '../config';
import { IsomorphicRepository, ServerRepository } from './type';

let cache = new WeakMap<{ new (): unknown }, IsomorphicRepository<any>>();

export function getIsomorphicRepository<T>(type: { new (): T }): IsomorphicRepository<T> {
  if (!cache.has(type)) {
    const conf = getOnqlOptions();
    if (!conf.defaultRepositoryClass) {
      throw new Error(
        `Either a generic repository or a specific repository (for the type ${type.name}) must be registered first`
      );
    }
    cache.set(type, new conf.defaultRepositoryClass(type));
  }
  return cache.get(type) as IsomorphicRepository<T>;
}

export function getServerRepository<T>(type: { new (): T }): ServerRepository<T> {
  return getIsomorphicRepository(type);
}

export function setCustomRepository<T>(type: { new (): T }, repository: IsomorphicRepository<T>): void {
  cache.set(type, repository);
}

/**
 * Useful for unit-testing
 */
export function resetContainer(): void {
  cache = new WeakMap<{ new (): unknown }, IsomorphicRepository<any>>();
}
