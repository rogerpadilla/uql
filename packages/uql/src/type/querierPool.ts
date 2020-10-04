import { QuerierContract } from './querier';

export type QuerierPoolClass = { new (opts: QuerierPoolOptions): QuerierPool };

export interface QuerierPoolOptions {
  host?: string;
  user?: string;
  password?: string;
  database?: string;
  port?: number;
}

export interface QuerierPoolConnection {
  query(query: string): Promise<any>;
  release(): void | Promise<void>;
}

export interface QuerierPool<T extends QuerierContract = QuerierContract> {
  getQuerier(): Promise<T>;
  end(): Promise<void>;
}
