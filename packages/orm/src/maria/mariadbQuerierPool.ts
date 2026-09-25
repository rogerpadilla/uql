import { createPool, type Pool } from 'mariadb';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { AbstractSqlQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { attachPoolErrorHandler, type ErrorEmittingPool } from '../util/index.js';
import { MariaDialect } from './mariaDialect.js';
import { MariadbQuerier } from './mariadbQuerier.js';

type PoolConfig = Exclude<Parameters<typeof createPool>[0], string>;

export class MariadbQuerierPool extends AbstractSqlQuerierPool<MariadbQuerier, MariaDialect> {
  readonly pool: Pool;

  constructor(opts: PoolConfig, extra?: ExtraOptions) {
    super(new MariaDialect(dialectOptionsFrom(extra)), extra);
    // BIGINT stays the driver's `bigint`, which `MariadbQuerier` decodes by the rule every driver here
    // shares (`decodeWideNumber`) - not `bigIntAsNumber`, which rounds past 2^53 without a word. A date
    // reads as its UTC text, which hydration decodes, since the connector would take it for local time
    // whatever `timezone` says; that only sets the session's zone, UTC, so `NOW()` agrees.
    this.pool = createPool({ timezone: 'Z', dateStrings: true, ...opts });
    // `mariadb` fires 'error' at runtime without declaring it, hence the cast; this makes it visible.
    attachPoolErrorHandler(
      this.pool as unknown as ErrorEmittingPool,
      'Idle MariaDB pool connection encountered an error',
      extra?.logger,
    );
  }

  async getQuerier() {
    return new MariadbQuerier(() => this.pool.getConnection(), this.dialect, this.extra);
  }

  async end() {
    await this.pool.end();
  }
}
