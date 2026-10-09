import { describeTextSearch } from '../querier/textSearch-test.js';
import { mongoUri } from '../test/index.js';
import { MongodbQuerierPool } from './mongodbQuerierPool.js';

describeTextSearch('MongoDB', () => new MongodbQuerierPool(mongoUri('uql_text')));
