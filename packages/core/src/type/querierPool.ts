import { Querier } from './querier';
import { QueryUpdateResult } from './query';

export type QuerierPoolOptions = {
  host?: string;
  user?: string;
  password?: string;
  database?: string;
  port?: number;
};

export type QuerierPoolSqlite3Options = { filename: string };

export type QuerierPoolConnection = {
  all<T>(query: string): Promise<T[]>;
  run(query: string): Promise<QueryUpdateResult>;
  release(): Promise<void>;
  end(): Promise<void>;
};

export type QuerierPool<Q extends Querier = Querier> = {
  getQuerier: () => Promise<Q>;
  end(): Promise<void>;
};
