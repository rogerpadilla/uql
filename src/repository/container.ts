import { getCorozoOptions } from '../config';
import { Repository, CustomRepositoryConstructor, ClientRepository, ServerRepository } from './type';

let cache = new WeakMap<{ new (): any }, Repository<any>>();

function getRepository<T>(type: { new (): T }): Repository<T> {
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
  return getRepository(type);
}

export function getServerRepository<T>(type: { new (): T }): ServerRepository<T> {
  return getRepository(type);
}

export function setRepository(constructor: CustomRepositoryConstructor<any>) {
  const repository = new constructor();
  cache.set(repository.meta.type, repository);
}

/**
 * Useful for unit-testing
 */
export function resetContainer() {
  cache = new WeakMap<{ new (): any }, Repository<any>>();
}
