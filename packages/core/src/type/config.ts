import type { NamingStrategy } from './namingStrategy.js';
import type { Dialect } from './querier.js';
import type { QuerierPool } from './querierPool.js';
import type { Type } from './utility.js';

export interface Config {
  pool?: QuerierPool;
  migrationsPath?: string;
  tableName?: string;
  dialect?: Dialect;
  entities?: Type<unknown>[];
  namingStrategy?: NamingStrategy;
}
