import { getMeta } from '@uql/core/entity/decorator';
import { BaseQuerierIt } from '@uql/core/querier/baseQuerier-it';
import { createSpec } from '@uql/core/test';
import { Collection } from 'mongodb';
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
    await querier.conn.db().dropDatabase({ writeConcern: 'majority' } as any);
  }

  // async dropTables() {
  //   const querier = this.querier as MongodbQuerier;
  //   const collections = await querier.conn.db().listCollections().toArray();
  //   await Promise.all(
  //     collections.map((collection: Collection) => querier.conn.db().dropCollection(collection.collectionName))
  //   );
  // }
}

createSpec(new MongodbQuerierIt());
