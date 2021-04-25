import { getEntityMeta } from '../../entity/decorator';
import { BaseQuerierPoolIt } from '../../querier/baseQuerierPoolIt';
import { createSpec } from '../../test';
import { MongodbQuerierPool } from './mongodbQuerierPool';
import { MongodbQuerier } from './mongodbQuerier';

class MongodbQuerierPoolIt extends BaseQuerierPoolIt {
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

  async createTables() {
    const querier = this.querier as MongodbQuerier;
    await Promise.all(
      this.entities.map((entity) => {
        const meta = getEntityMeta(entity);
        return querier.conn.db().createCollection(meta.name);
      })
    );
  }

  async dropTables() {
    const querier = this.querier as MongodbQuerier;
    await querier.conn.db().dropDatabase();
  }
}

createSpec(new MongodbQuerierPoolIt());
