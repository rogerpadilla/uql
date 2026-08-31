import type { Config } from '@libsql/client';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import type { HranaClient, HranaQuerierConnectionOptions } from '../sqlite/hranaQuerier.js';
import { AbstractHranaQuerierPool } from '../sqlite/hranaQuerierPool.js';
import type { ExtraOptions } from '../type/index.js';
import { LibsqlDialect } from './libsqlDialect.js';
import { LibsqlQuerier } from './libsqlQuerier.js';

/** Embedded replica: local `file:` DB + `syncUrl` remote - DDL should run on the remote (sqld). */
export function libsqlUseRemoteForMigrations(config: Pick<Config, 'url' | 'syncUrl'>): boolean {
  return Boolean(config.syncUrl && config.url.startsWith('file:'));
}

/** Remote-only client: same options as the replica, but `url` is `syncUrl` and embedded-replica fields are dropped. */
function remoteMigrationClientConfig(config: Config): Config {
  const { syncUrl, url: _localUrl, ...rest } = config;
  return { ...rest, url: syncUrl! };
}

export class LibsqlQuerierPool extends AbstractHranaQuerierPool<LibsqlQuerier, LibsqlDialect> {
  constructor(
    private readonly conf: Config,
    extra?: ExtraOptions,
  ) {
    super(new LibsqlDialect(dialectOptionsFrom(extra)), extra);
  }

  protected override openClient() {
    return this.createClient(this.conf);
  }

  protected override buildQuerier(client: HranaClient, connection?: HranaQuerierConnectionOptions) {
    return new LibsqlQuerier(client, this.dialect, this.extra, connection);
  }

  /**
   * For embedded replicas (`file:` + `syncUrl`), returns a querier connected to `syncUrl` so migrations hit sqld.
   * Otherwise same as `getQuerier`. The migrator calls this for `up`/`down`, `syncForce`, and `autoSync` DDL.
   */
  async getMigrationQuerier(): Promise<LibsqlQuerier> {
    if (!libsqlUseRemoteForMigrations(this.conf)) {
      return this.getQuerier();
    }
    const remote = await this.createClient(remoteMigrationClientConfig(this.conf));
    return this.buildQuerier(remote, { closeClientOnRelease: true });
  }

  /** Imported on use, so `uql-orm/libsql` loads without the optional `@libsql/client` peer installed. */
  private async createClient(conf: Config): Promise<HranaClient> {
    const { createClient } = await import('@libsql/client');
    return createClient(conf);
  }
}
