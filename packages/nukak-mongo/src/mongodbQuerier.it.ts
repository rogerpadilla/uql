import { AbstractQuerierIt } from 'nukak/querier/abstractQuerier-it.js';
import { createSpec } from 'nukak/test';
import { getEntities, getMeta } from 'nukak/entity';
import { MongodbQuerierPool } from './mongodbQuerierPool.js';
import { MongodbQuerier } from './mongodbQuerier.js';

class MongodbQuerierIt extends AbstractQuerierIt<MongodbQuerier> {
  constructor() {
    super(
      new MongodbQuerierPool('mongodb://127.0.0.1:27027,127.0.0.1:27028,127.0.0.1:27029/test?replicaSet=rs', {
        serverApi: {
          version: '1',
          strict: true,
          deprecationErrors: true,
        },
      }),
    );
  }

  override async createTables() {
    const entities = getEntities();
    await Promise.all(
      entities.map((entity) => {
        const meta = getMeta(entity);
        return this.querier.conn.db().createCollection(meta.name);
      }),
    );
  }

  override async dropTables() {
    await this.querier.conn.db().dropDatabase();
  }
}

createSpec(new MongodbQuerierIt());
