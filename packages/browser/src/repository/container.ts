import { ClientRepository } from '../type';
import { getIsomorphicRepository } from '../../../core/src/repository/container';

export function getClientRepository<T>(type: { new (): T }): ClientRepository<T> {
  return getIsomorphicRepository(type);
}
