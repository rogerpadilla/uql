import { Querier } from './querier';

export type QuerierPoolOptions = {
  host?: string;
  user?: string;
  password?: string;
  database?: string;
  port?: number;
};

export type QuerierPoolSqlite3Options = { filename: string };

export type QuerierPoolConnection = {
  query(query: string, ...args: any[]): Promise<any>;
  release(): void | Promise<void>;
};

export type QuerierPool<Q extends Querier = Querier> = {
  getQuerier: () => Promise<Q>;
  end(): Promise<void>;
};
