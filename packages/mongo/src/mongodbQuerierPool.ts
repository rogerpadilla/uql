import { MongoClient, type MongoClientOptions } from 'mongodb';
import { AbstractQuerierPool } from 'nukak/querier';
import type { ExtraOptions } from 'nukak/type';
import { MongoDialect } from './mongoDialect.js';
import { MongodbQuerier } from './mongodbQuerier.js';

export class MongodbQuerierPool extends AbstractQuerierPool<MongodbQuerier> {
  private readonly client: MongoClient;

  constructor(uri: string, opts?: MongoClientOptions, extra?: ExtraOptions) {
    super(extra);
    this.client = new MongoClient(uri, opts);
  }

  async getQuerier() {
    const conn = await this.client.connect();
    const querier = new MongodbQuerier(new MongoDialect(), conn, this.extra);
    return querier;
  }

  async end() {
    await this.client.close();
  }
}
