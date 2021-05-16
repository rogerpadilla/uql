import { ClientQuerier } from '../type';
import { HttpQuerier } from './httpQuerier';

export function getQuerier(): Promise<ClientQuerier> {
  const querier = new HttpQuerier();
  return Promise.resolve(querier);
}
