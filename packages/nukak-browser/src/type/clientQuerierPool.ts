import { ClientQuerier } from './clientQuerier';

export type ClientQuerierPool = {
  getQuerier(): ClientQuerier;
};
