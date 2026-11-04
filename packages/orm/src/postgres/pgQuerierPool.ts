import type { PoolConfig } from 'pg';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import type { ExtraOptions } from '../type/index.js';
import { AbstractPgQuerierPool } from './abstractPgQuerierPool.js';
import { PostgresDialect } from './postgresDialect.js';

export class PgQuerierPool extends AbstractPgQuerierPool<PostgresDialect> {
  constructor(opts: PoolConfig, extra?: ExtraOptions) {
    super(new PostgresDialect(dialectOptionsFrom(extra)), opts, extra);
  }
}
