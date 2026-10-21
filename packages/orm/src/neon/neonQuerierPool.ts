import { Client, type ClientConfig, neon, types } from '@neondatabase/serverless';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { pgExecution } from '../postgres/pgExecution.js';
import { PgQuerier } from '../postgres/pgQuerier.js';
import { wireTypes } from '../postgres/pgWireTypes.js';
import { AbstractSqlQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { NeonDialect } from './neonDialect.js';
import { type NeonHttp, NeonQuerier } from './neonQuerier.js';

const ignoreError = () => {};

/**
 * A WebSocket session of one querier's own, ended where a pooled client would be handed back. A socket error while
 * it closes is heard and dropped, as `pg-pool` hears one on a client it holds, rather than reaching no listener.
 */
class NeonSession extends Client {
  release(): Promise<void> {
    this.on('error', ignoreError);
    return this.end();
  }
}

/**
 * Pool for Neon that holds no connection: its queriers send statements and lists over HTTP, and open a WebSocket
 * session of their own only for a transaction or a stream, which their release ends. So one pool serves every
 * request of an edge isolate. A migration runs on a session throughout, since its lock is the session's.
 * [The design](../../../../architecture/split-writes.md).
 */
export class NeonQuerierPool extends AbstractSqlQuerierPool<PgQuerier, NeonDialect> {
  readonly #http: NeonHttp;
  readonly #config: ClientConfig;

  constructor(opts: ClientConfig, extra?: ExtraOptions) {
    super(new NeonDialect(dialectOptionsFrom(extra)), extra);
    // Neon's own `types`, not `pg`'s: this entry has to load on an edge runtime where `pg` is absent.
    const wire = opts.types ?? wireTypes(types);
    this.#config = { ...opts, types: wire };
    const { connectionString, host, port, user, password, database } = opts;
    const http = neon({ connectionString, host, port, user, password, database, fullResults: true });
    // Each query passes the wire types itself, since `neon()` ignores them, so a row decodes as over a session.
    const query = (sql: string, values?: unknown[]) => http.query(sql, values, { types: wire });
    this.#http = {
      query: async (sql, values) => pgExecution(await query(sql, values)),
      transaction: async (statements) =>
        (await http.transaction(statements.map(({ sql, values }) => query(sql, values)))).map(pgExecution),
    };
  }

  override async getQuerier() {
    return new NeonQuerier(this.#http, () => this.#session(), this.dialect, this.extra);
  }

  async getMigrationQuerier(): Promise<PgQuerier> {
    return new PgQuerier(() => this.#session(), this.dialect, this.extra);
  }

  async #session(): Promise<NeonSession> {
    const session = new NeonSession(this.#config);
    await session.connect();
    return session;
  }
}
