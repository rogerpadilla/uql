import { getEntities, getMeta } from '@uql/core/entity/decorator';
import { AbstractQuerierIt } from '@uql/core/querier/abstractQuerier-it';
import { createSpec } from '@uql/core/test';
import { MongodbQuerierPool } from './mongodbQuerierPool';
import { MongodbQuerier } from './mongodbQuerier';

class MongodbQuerierIt extends AbstractQuerierIt<MongodbQuerier> {
  constructor() {
    super(
      new MongodbQuerierPool(`mongodb://localhost/test?replicaSet=rs`, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      })
    );
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
