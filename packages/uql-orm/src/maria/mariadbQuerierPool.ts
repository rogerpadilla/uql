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
    // shares (`decodeWideNumber`) - not `bigIntAsNumber`, which rounds past 2^53 without a word.
    this.pool = createPool(opts);
    // `mariadb`'s own `createPool` already attaches a silent no-op 'error'
    // listener (so a dropped connection can't crash the process), but its
    // `Pool` type only declares `on` for 'acquire' | 'connection' | 'enqueue'
    // | 'release' - 'error' genuinely fires at runtime (see `lib/pool.js`)
    // but isn't in the declaration, hence the cast. Re-attaching our own
    // listener here just makes the error visible instead of a silent no-op.
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
