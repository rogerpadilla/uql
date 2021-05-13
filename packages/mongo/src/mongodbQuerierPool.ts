import * as mongodb from 'mongodb';
import { QuerierPool, QuerierPoolOptions } from '@uql/core/type';
import { MongodbQuerier } from './mongodbQuerier';

export class MongodbQuerierPool implements QuerierPool<MongodbQuerier> {
  constructor(readonly opts: QuerierPoolOptions) {}

  async getQuerier() {
    const uri = `mongodb://${this.opts.host}${this.opts.port ? `:${this.opts.port}` : ''}/${this.opts.database}`;
    const conn = await mongodb.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true }).;
    return new MongodbQuerier(conn);
  }

  async end() {
    // noop
  }
}
