import * as mongoose from 'mongodb';
import { QuerierPool, QuerierPoolOptions } from 'uql/type';
import { MongodbQuerier } from './mongodbQuerier';

export class MongodbQuerierPool implements QuerierPool<MongodbQuerier> {
  constructor(readonly opts: QuerierPoolOptions) {}

  async getQuerier() {
    const uri = `mongodb://${this.opts.host}${this.opts.port ? `:${this.opts.port}` : ''}/${this.opts.database}`;
    const conn = await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    return new MongodbQuerier(conn);
  }

  end() {
    // noop
    return Promise.resolve();
  }
}

export default MongodbQuerierPool;
