import { type Client, type Config, createClient } from '@libsql/client';
import { AbstractQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { LibsqlDialect } from './libsqlDialect.js';
import { LibsqlQuerier } from './libsqlQuerier.js';

/** Embedded replica: local `file:` DB + `syncUrl` remote — DDL should run on the remote (sqld). */
export function libsqlUseRemoteForMigrations(config: Pick<Config, 'url' | 'syncUrl'>): boolean {
  return Boolean(config.syncUrl && config.url.startsWith('file:'));
}

/** Remote-only client: same options as the replica, but `url` is `syncUrl` and embedded-replica fields are dropped. */
function remoteMigrationClientConfig(config: Config): Config {
  const { syncUrl, url: _localUrl, ...rest } = config;
  return { ...rest, url: syncUrl! };
}

export class LibsqlQuerierPool extends AbstractQuerierPool<LibsqlDialect, LibsqlQuerier> {
  readonly client: Client;
  private readonly libsqlConfig: Config;

  constructor(conf: Config, extra?: ExtraOptions) {
    super(new LibsqlDialect({ namingStrategy: extra?.namingStrategy }), extra);
    this.libsqlConfig = conf;
    this.client = createClient(conf);
  }

  async getQuerier() {
    return new LibsqlQuerier(this.client, this.dialect, this.extra);
  }

  /**
   * For embedded replicas (`file:` + `syncUrl`), returns a querier connected to `syncUrl` so migrations hit sqld.
   * Otherwise same as {@link getQuerier}. The migrator calls this for `up`/`down`, `syncForce`, and `autoSync` DDL.
   */
  async getMigrationQuerier(): Promise<LibsqlQuerier> {
    if (!libsqlUseRemoteForMigrations(this.libsqlConfig)) {
      return this.getQuerier();
    }
    const remote = createClient(remoteMigrationClientConfig(this.libsqlConfig));
    return new LibsqlQuerier(remote, this.dialect, this.extra, { closeClientOnRelease: true });
  }

  async end() {
    this.client.close();
  }
}
