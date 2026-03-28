import { type Client, type Config, createClient } from '@libsql/client';
import { AbstractQuerierPool } from '../querier/index.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import type { ExtraOptions } from '../type/index.js';
import { LibsqlQuerier } from './libsqlQuerier.js';

export class LibsqlQuerierPool extends AbstractQuerierPool<SqliteDialect, LibsqlQuerier> {
  readonly client: Client;

  constructor(
    readonly config: Config,
    extra?: ExtraOptions,
  ) {
    super(new SqliteDialect(extra?.namingStrategy), extra);
    this.client = createClient(config);
  }

  async getQuerier() {
    return new LibsqlQuerier(this.client, this.dialectInstance, this.extra);
  }

  async end() {
    this.client.close();
  }
}
