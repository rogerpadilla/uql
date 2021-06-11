import { getMeta } from '@uql/core/entity/decorator';
import { BaseQuerierIt } from '@uql/core/querier/baseQuerier-it';
import { createSpec } from '@uql/core/test';
import { MongodbQuerierPool } from './mongodbQuerierPool';
import { MongodbQuerier } from './mongodbQuerier';

class MongodbQuerierIt extends BaseQuerierIt<MongodbQuerier> {
  constructor() {
    super(
      new MongodbQuerierPool({
        host: 'localhost',
        port: 27017,
        database: 'test?replicaSet=rs',
      })
    );
  }

  async createTables() {
    const querier = this.querier as MongodbQuerier;
    await Promise.all(
      this.entities.map((entity) => {
        const meta = getMeta(entity);
        return querier.conn.db().createCollection(meta.name);
      })
    );
  }

  async dropTables() {
    const querier = this.querier as MongodbQuerier;
    await querier.conn.db().dropDatabase();
  }
}

createSpec(new MongodbQuerierIt());
