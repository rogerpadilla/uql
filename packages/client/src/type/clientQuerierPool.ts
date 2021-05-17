import { ClientQuerier } from './clientQuerier';

export type ClientQuerierPool = {
  getQuerier(): Promise<ClientQuerier>;
};
