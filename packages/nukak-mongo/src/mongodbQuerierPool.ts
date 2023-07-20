import { MongoClient, MongoClientOptions } from 'mongodb';
import type { ExtraOptions, QuerierPool } from 'nukak/type';
import { MongodbQuerier } from './mongodbQuerier.js';
import { MongoDialect } from './mongoDialect.js';

export class MongodbQuerierPool implements QuerierPool<MongodbQuerier> {
  private readonly client: MongoClient;

  constructor(
    uri: string,
    opts?: MongoClientOptions,
    readonly extra?: ExtraOptions,
  ) {
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
