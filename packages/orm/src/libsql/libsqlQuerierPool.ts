import type { Config } from '@libsql/client';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { AbstractSharedHandleQuerierPool } from '../querier/abstractSharedHandleQuerierPool.js';
import { type HranaClient, HranaQuerier } from '../sqlite/hranaQuerier.js';
import type { ExtraOptions } from '../type/index.js';
import { LibsqlDialect } from './libsqlDialect.js';

/**
 * Pool for libSQL. One client serves every querier, since Hrana keeps no per-connection state: a
 * transaction takes its own session handle. The pool builds that client from `@libsql/client`'s
 * `Config`, or shares one the caller built (`@libsql/client/web`, `@libsql/client-wasm`), which stays
 * theirs to close.
 */
export class LibsqlQuerierPool extends AbstractSharedHandleQuerierPool<HranaClient, HranaQuerier, LibsqlDialect> {
  constructor(
    private readonly conf: Config | HranaClient,
    extra?: ExtraOptions,
  ) {
    super(new LibsqlDialect(dialectOptionsFrom(extra)), extra);
  }

  protected override async openDb() {
    return 'execute' in this.conf ? this.conf : this.createClient(this.conf);
  }

  protected override buildQuerier(client: HranaClient) {
    return new HranaQuerier(client, this.dialect, this.extra);
  }

  override async end() {
    if (!('execute' in this.conf)) {
      await super.end();
    }
  }

  /**
   * For an embedded replica - a `file:` url with a `syncUrl` - a querier on the sync url, so migrations
   * reach sqld, its client closing with it. Anything else migrates like any other querier.
   */
  async getMigrationQuerier(): Promise<HranaQuerier> {
    if ('execute' in this.conf) {
      return this.getQuerier();
    }
    const { syncUrl, url, ...remote } = this.conf;
    if (!syncUrl || !url.startsWith('file:')) {
      return this.getQuerier();
    }
    const client = await this.createClient({ ...remote, url: syncUrl });
    return new HranaQuerier(client, this.dialect, this.extra, { closeClientOnRelease: true });
  }

  /**
   * Imported on use, so `uql-orm/libsql` loads without the optional `@libsql/client` peer installed.
   * Integers read as `bigint` whatever the config asks, so the querier decodes one past 2^53 exactly.
   */
  private async createClient(conf: Config): Promise<HranaClient> {
    const { createClient } = await import('@libsql/client');
    return createClient({ ...conf, intMode: 'bigint' });
  }
}
