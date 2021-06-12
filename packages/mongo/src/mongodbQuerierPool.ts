import { connect, MongoClientOptions } from 'mongodb';
import { QuerierPool } from '@uql/core/type';
import { MongodbQuerier } from './mongodbQuerier';

export class MongodbQuerierPool implements QuerierPool<MongodbQuerier> {
  private querier: MongodbQuerier;

  constructor(readonly uri: string, readonly options?: MongoClientOptions) {}

  async getQuerier() {
    if (!this.querier || !this.querier.conn.isConnected()) {
      const conn = await connect(this.uri, this.options);
      this.querier = new MongodbQuerier(conn);
    }
    return this.querier;
  }

  async end() {
    await this.querier.conn.close();
    delete this.querier;
  }
}
