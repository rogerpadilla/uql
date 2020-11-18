import { getOptions } from 'uql/options';
import { IsomorphicRepository, Repository } from 'uql/type';

let repositoriesCache: WeakMap<{ new (): unknown }, IsomorphicRepository<any>>;

export function getIsomorphicRepository<T>(type: { new (): T }): IsomorphicRepository<T> {
  const options = getOptions();
  if (!repositoriesCache.has(type)) {
    if (!options.defaultRepositoryClass) {
      throw new TypeError(
        `either a generic repository or a specific repository (for the type ${type.name}) must be registered first`
      );
    }
    repositoriesCache.set(type, new options.defaultRepositoryClass(type));
  }
  return repositoriesCache.get(type) as IsomorphicRepository<T>;
}

export function getRepository<T>(type: { new (): T }): Repository<T> {
  return getIsomorphicRepository(type);
}

export function setCustomRepository<T>(repository: IsomorphicRepository<T>): void {
  repositoriesCache.set(repository.meta.type, repository);
}

export function clearRepositoriesCache() {
  repositoriesCache = new WeakMap<{ new (): unknown }, IsomorphicRepository<any>>();
}
