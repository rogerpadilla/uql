import { type Client, type Config, createClient } from '@libsql/client';
import { AbstractQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { LibsqlQuerier } from './libsqlQuerier.js';

export class LibsqlQuerierPool extends AbstractQuerierPool<LibsqlQuerier> {
  readonly client: Client;

  constructor(
    readonly config: Config,
    extra?: ExtraOptions,
  ) {
    super('sqlite', extra);
    this.client = createClient(config);
  }

  async getQuerier() {
    return new LibsqlQuerier(this.client, this.extra);
  }

  async end() {
    this.client.close();
  }
}
