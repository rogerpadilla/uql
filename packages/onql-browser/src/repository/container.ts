import { getIsomorphicRepository } from 'onql/repository/container';
import { ClientRepository } from '../type';

export function getClientRepository<T>(type: { new (): T }): ClientRepository<T> {
  return getIsomorphicRepository(type);
}