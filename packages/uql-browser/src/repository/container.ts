import { getIsomorphicRepository } from 'uql/repository';
import { HttpRepository } from '../type';

export function getRepository<T>(type: { new (): T }): HttpRepository<T> {
  return getIsomorphicRepository(type);
}
