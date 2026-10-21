import { neon, Pool, type PoolClient, type PoolConfig, types } from '@neondatabase/serverless';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { AbstractPgQuerierPool } from '../postgres/abstractPgQuerierPool.js';
import { PgQuerier } from '../postgres/pgQuerier.js';
import { wireTypes } from '../postgres/pgWireTypes.js';
import type { ExtraOptions } from '../type/index.js';
import { NeonDialect } from './neonDialect.js';
import { type NeonHttp, NeonQuerier } from './neonQuerier.js';

/**
 * Pool for Neon, over HTTP first: its queriers send statements and lists over HTTP, taking a WebSocket session
 * from its `pool` only for a transaction or a stream. A migration runs on a session throughout, since its lock
 * is the session's. [The design](../../../../architecture/split-writes.md).
 */
export class NeonQuerierPool extends AbstractPgQuerierPool<PoolClient, NeonDialect> {
  declare readonly pool: Pool;
  readonly #http: NeonHttp;
  readonly #types: NonNullable<PoolConfig['types']>;

  constructor(opts: PoolConfig, extra?: ExtraOptions) {
    // Neon's own `types`, not `pg`'s: this entry has to load on an edge runtime where `pg` is absent.
    const wire = opts.types ?? wireTypes(types);
    super(new NeonDialect(dialectOptionsFrom(extra)), new Pool({ ...opts, types: wire }), extra);
    const { connectionString, host, port, user, password, database } = opts;
    this.#http = neon({ connectionString, host, port, user, password, database, fullResults: true });
    this.#types = wire;
  }

  override async getQuerier() {
    return new NeonQuerier(this.#http, this.#types, () => this.pool.connect(), this.dialect, this.extra);
  }

  async getMigrationQuerier() {
    return new PgQuerier(() => this.pool.connect(), this.dialect, this.extra);
  }
}
