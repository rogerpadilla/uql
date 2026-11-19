import type { PoolConfig } from 'pg';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import type { DriverPoolOptions } from '../type/index.js';
import { AbstractPgQuerierPool } from './abstractPgQuerierPool.js';
import { PostgresDialect } from './postgresDialect.js';

export class PgQuerierPool extends AbstractPgQuerierPool<PostgresDialect> {
  constructor(opts: PoolConfig, extra?: DriverPoolOptions<PoolConfig>) {
    super(new PostgresDialect(dialectOptionsFrom(extra)), opts, extra);
  }
}
