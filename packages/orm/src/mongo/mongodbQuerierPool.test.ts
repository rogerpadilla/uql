import { AbstractQuerierPoolIt } from '../querier/abstractQuerierPool-test.js';
import { createSpec, mongoUri } from '../test/index.js';
import type { MongodbQuerier } from './mongodbQuerier.js';
import { MongodbQuerierPool } from './mongodbQuerierPool.js';

class MongodbQuerierPoolIt extends AbstractQuerierPoolIt<MongodbQuerier> {}

createSpec(new MongodbQuerierPoolIt(new MongodbQuerierPool(mongoUri('uql_pool'))));
