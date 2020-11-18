import { getIsomorphicRepository } from 'uql/repository/container';
import { HttpRepository } from '../type';

export function getRepository<T>(type: { new (): T }): HttpRepository<T> {
  return getIsomorphicRepository(type);
}
