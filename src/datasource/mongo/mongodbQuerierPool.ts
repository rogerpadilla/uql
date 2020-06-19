import * as mongoose from 'mongodb';
import { QuerierPool, QuerierPoolOptions } from '../type';
import { MongodbQuerier } from './mongodbQuerier';

export default class MongodbQuerierPool implements QuerierPool {
  constructor(protected readonly opts: QuerierPoolOptions) {}

  async getQuerier(): Promise<MongodbQuerier> {
    const uri = `mongodb://${this.opts.host}${this.opts.port ? `:${this.opts.port}` : ''}/${this.opts.database}`;
    const conn = await mongoose.connect(uri, { useNewUrlParser: true });
    return new MongodbQuerier(conn);
  }
}
