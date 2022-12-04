import { AbstractQuerierIt } from 'nukak/querier/abstractQuerier-it.js';
import { createSpec } from 'nukak/test';
import { getEntities, getMeta } from 'nukak/entity';
import { MongodbQuerierPool } from './mongodbQuerierPool.js';
import { MongodbQuerier } from './mongodbQuerier.js';

class MongodbQuerierIt extends AbstractQuerierIt<MongodbQuerier> {
  constructor() {
    super(new MongodbQuerierPool('mongodb://localhost:27020,localhost:27028,localhost:27029/test?replicaSet=rs'));
  }

  override async createTables() {
    const entities = getEntities();
    await Promise.all(
      entities.map((entity) => {
        const meta = getMeta(entity);
        return this.querier.conn.db().createCollection(meta.name);
      })
    );
  }

  override async dropTables() {
    await this.querier.conn.db().dropDatabase();
  }
}

createSpec(new MongodbQuerierIt());
