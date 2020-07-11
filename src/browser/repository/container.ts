import { ClientRepository } from '../type';
import { getIsomorphicRepository } from '../../core/repository';

export function getClientRepository<T>(type: { new (): T }): ClientRepository<T> {
  return getIsomorphicRepository(type);
}
