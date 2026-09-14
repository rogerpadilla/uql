import type { Config } from '@tursodatabase/serverless';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { AbstractSqlQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { TursoDialect } from './tursoDialect.js';
import { TursoSessionQuerier } from './tursoSessionQuerier.js';

/** Connection settings for Turso Cloud: `@tursodatabase/serverless`'s own, `requestHeaders` included. */
export type TursoConfig = Config;

/**
 * Pool for Turso Cloud, over `@tursodatabase/serverless`, which speaks HTTP through `fetch()`.
 *
 * @remarks Every querier opens a session of its own, one server stream, so queriers never wait on each
 * other and a transaction spans one stream. The driver is imported on first use, so a pool built at
 * module scope in a Worker loads nothing until a request needs it. A client built with
 * `@libsql/client/web` goes to `LibsqlQuerierPool` instead.
 */
export class TursoQuerierPool extends AbstractSqlQuerierPool<TursoSessionQuerier, TursoDialect> {
  constructor(
    private readonly conf: TursoConfig,
    extra?: ExtraOptions,
  ) {
    super(new TursoDialect(dialectOptionsFrom(extra)), extra);
  }

  async getQuerier() {
    const { Session } = await import('@tursodatabase/serverless');
    return new TursoSessionQuerier(new Session(this.conf), this.dialect, this.extra);
  }

  /** Nothing to close: every querier closes its own session. */
  async end() {}
}
