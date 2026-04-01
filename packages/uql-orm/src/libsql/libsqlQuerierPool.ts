import { type Client, type Config, createClient } from '@libsql/client';
import { AbstractQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { LibsqlDialect } from './libsqlDialect.js';
import { LibsqlQuerier } from './libsqlQuerier.js';

export class LibsqlQuerierPool extends AbstractQuerierPool<LibsqlDialect, LibsqlQuerier> {
  readonly client: Client;

  constructor(conf: Config, extra?: ExtraOptions) {
    super(new LibsqlDialect({ namingStrategy: extra?.namingStrategy }), extra);
    this.client = createClient(conf);
  }

  async getQuerier() {
    return new LibsqlQuerier(this.client, this.dialect, this.extra);
  }

  async end() {
    this.client.close();
  }
}
