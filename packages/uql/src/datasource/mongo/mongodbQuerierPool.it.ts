import { createSpec } from 'uql/test.util';
import { getEntityMeta } from 'uql/decorator';
import { QuerierPoolSpec } from '../querierPoolSpec';
import MongodbQuerierPool from './mongodbQuerierPool';
import { MongodbQuerier } from './mongodbQuerier';

class MongodbQuerierPoolSpec extends QuerierPoolSpec {
  constructor() {
    super(
      new MongodbQuerierPool({
        host: 'localhost',
        port: 27017,
        database: 'test?replicaSet=rs',
      })
    );
  }

  async shouldThrowIfQueryMongo() {
    await expect(this.querier.query('something')).rejects.toThrow('method not implemented');
  }

  createTables() {
    const querier = this.querier as MongodbQuerier;
    return Promise.all(
      this.entities.map((entity) => {
        const meta = getEntityMeta(entity);
        return querier.conn.db().createCollection(meta.name);
      })
    );
  }

  dropTables() {
    const querier = this.querier as MongodbQuerier;
    return querier.conn.db().dropDatabase();
  }
}

createSpec(new MongodbQuerierPoolSpec());
