import { MongoClient, type MongoClientOptions } from 'mongodb';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { AbstractQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { MongoDialect } from './mongoDialect.js';
import { MongodbQuerier } from './mongodbQuerier.js';

export class MongodbQuerierPool extends AbstractQuerierPool<MongodbQuerier, MongoDialect> {
  private readonly client: MongoClient;

  constructor(uri: string, opts?: MongoClientOptions, extra?: ExtraOptions) {
    super(new MongoDialect(dialectOptionsFrom(extra)), extra);
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
