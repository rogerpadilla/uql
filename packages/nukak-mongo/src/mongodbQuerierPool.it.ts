import { AbstractQuerierPoolIt } from 'nukak/querier/abstractQuerierPool-it.js';
import { createSpec } from 'nukak/test';
import { MongodbQuerierPool } from './mongodbQuerierPool.js';
import { MongodbQuerier } from './mongodbQuerier.js';

class MongodbQuerierPoolIt extends AbstractQuerierPoolIt<MongodbQuerier> {
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
}

createSpec(new MongodbQuerierPoolIt());
