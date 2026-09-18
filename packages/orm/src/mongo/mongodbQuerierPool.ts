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
    // A 64-bit integer read as the exact `bigint` it is, where the driver would round it past 2^53 or
    // hand back its own `Long`; each read then decodes it the way every SQL driver does. First, as the
    // MySQL pool's `supportBigNumbers` is, so an explicit choice of the caller's wins.
    this.client = new MongoClient(uri, { useBigInt64: true, ...opts });
  }

  async getQuerier() {
    const conn = await this.client.connect();
    return new MongodbQuerier(this.dialect, conn, this.extra);
  }

  async end() {
    await this.client.close();
  }
}
