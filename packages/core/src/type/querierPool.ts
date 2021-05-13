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

export type GetQuerier<E extends Querier = Querier> = () => Promise<E>;

export type QuerierPool<E extends Querier = Querier> = {
  getQuerier: GetQuerier<E>;
  end(): Promise<void>;
};
