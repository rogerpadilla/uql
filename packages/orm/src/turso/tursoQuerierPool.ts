import type { Config } from '@tursodatabase/serverless';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { AbstractSqlQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { TursoDialect } from './tursoDialect.js';
import { TursoSessionQuerier } from './tursoSessionQuerier.js';

/** Connection settings for Turso Cloud: `@tursodatabase/serverless`'s own, `requestHeaders` included. */
export type TursoConfig = Config;

/**
 * A pool for Turso Cloud over `@tursodatabase/serverless`: a stream per querier, the driver imported on first
 * use. A `@libsql/client/web` client goes to `LibsqlQuerierPool` instead.
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
