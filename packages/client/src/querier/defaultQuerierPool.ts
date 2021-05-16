import { Querier } from './querier';

export function getQuerier(): Promise<Querier> {
  return Promise.resolve(new Querier());
}
