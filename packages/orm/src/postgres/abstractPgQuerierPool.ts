import { Pool, type PoolConfig, types } from 'pg';
import type { AbstractSqlDialect } from '../dialect/index.js';
import { AbstractSqlQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { attachPoolErrorHandler } from '../util/index.js';
import { PgQuerier } from './pgQuerier.js';
import { wireTypes } from './pgWireTypes.js';

/** A `pg` pool of {@link PgQuerier}s, whose error handler keeps a dropped connection from crashing the process. */
export abstract class AbstractPgQuerierPool<D extends AbstractSqlDialect> extends AbstractSqlQuerierPool<PgQuerier, D> {
  readonly pool: Pool;

  constructor(dialect: D, opts: PoolConfig, extra?: ExtraOptions) {
    super(dialect, extra);
    // keepAlive cuts down, but cannot stop, a NAT or firewall silently dropping an idle remote connection.
    this.pool = new Pool({ keepAlive: true, types: wireTypes(types), ...opts });
    attachPoolErrorHandler(this.pool, 'Idle Postgres pool client encountered an error', extra?.logger);
  }

  async getQuerier() {
    return new PgQuerier(() => this.pool.connect(), this.dialect, this.extra);
  }

  override async end() {
    await this.pool.end();
  }
}
