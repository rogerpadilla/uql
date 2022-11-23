import { ClientQuerier } from './clientQuerier.js';

export type ClientQuerierPool = {
  getQuerier(): ClientQuerier;
};
