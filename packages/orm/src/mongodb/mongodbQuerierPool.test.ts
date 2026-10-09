import { QuerierPoolIt } from '../querier/abstractQuerierPool-test.js';
import { createSpec, mongoUri } from '../test/index.js';
import { MongodbQuerierPool } from './mongodbQuerierPool.js';

createSpec(new QuerierPoolIt(() => new MongodbQuerierPool(mongoUri('uql_pool'))));
