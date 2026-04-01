import { MongoClient, type MongoClientOptions } from 'mongodb';
import { AbstractQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { MongodbNativeDialect } from './mongodbNativeDialect.js';
import { MongodbQuerier } from './mongodbQuerier.js';

export class MongodbQuerierPool extends AbstractQuerierPool<MongodbNativeDialect, MongodbQuerier> {
  private readonly client: MongoClient;

  constructor(uri: string, opts?: MongoClientOptions, extra?: ExtraOptions) {
    super(new MongodbNativeDialect({ namingStrategy: extra?.namingStrategy }), extra);
    this.client = new MongoClient(uri, opts);
  }

  async getQuerier() {
    const conn = await this.client.connect();
    return new MongodbQuerier(this.dialect, conn, this.extra);
  }

  async end() {
    await this.client.close();
  }
}
