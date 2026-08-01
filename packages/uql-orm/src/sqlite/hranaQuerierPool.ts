import { AbstractSqlQuerierPool } from '../querier/index.js';
import type { HranaClient, HranaQuerier, HranaQuerierConnectionOptions } from './hranaQuerier.js';
import type { SqliteDialect } from './sqliteDialect.js';

/**
 * Pool for SQLite databases reached over the Hrana wire protocol (`@libsql/client`,
 * `@tursodatabase/serverless/compat`).
 *
 * @remarks The client is shared by every querier, since Hrana keeps no per-connection state: a
 * transaction takes its own session handle. It is resolved on first use rather than in the
 * constructor, so building a pool never throws when the optional driver peer is absent, which is what
 * lets a Workers bundle construct one at module scope.
 */
export abstract class AbstractHranaQuerierPool<
  Q extends HranaQuerier,
  D extends SqliteDialect,
> extends AbstractSqlQuerierPool<Q, D> {
  private client?: HranaClient;

  /** False when the caller injected their own client, in which case they own its lifecycle. */
  protected readonly ownsClient: boolean = true;

  protected abstract openClient(): Promise<HranaClient>;

  protected abstract buildQuerier(client: HranaClient, connection?: HranaQuerierConnectionOptions): Q;

  async getQuerier() {
    this.client ??= await this.openClient();
    return this.buildQuerier(this.client);
  }

  async end() {
    if (this.ownsClient) {
      this.client?.close();
    }
    this.client = undefined;
  }
}
