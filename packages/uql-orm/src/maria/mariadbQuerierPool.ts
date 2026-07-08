import { createPool, type Pool } from 'mariadb';
import { AbstractQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { attachPoolErrorHandler, type ErrorEmittingPool } from '../util/index.js';
import { MariaDialect } from './mariaDialect.js';
import { MariadbQuerier } from './mariadbQuerier.js';

type PoolConfig = Exclude<Parameters<typeof createPool>[0], string>;

export class MariadbQuerierPool extends AbstractQuerierPool<MariaDialect, MariadbQuerier> {
  readonly pool: Pool;

  constructor(opts: PoolConfig, extra?: ExtraOptions) {
    super(new MariaDialect({ namingStrategy: extra?.namingStrategy }), extra);
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
    );
  }

  async getQuerier() {
    return new MariadbQuerier(() => this.pool.getConnection(), this.dialect, this.extra);
  }

  async end() {
    await this.pool.end();
  }
}
