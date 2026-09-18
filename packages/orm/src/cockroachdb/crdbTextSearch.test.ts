import { describeTextSearch } from '../querier/textSearch-test.js';
import { cockroachConnection } from '../test/index.js';
import { CrdbQuerierPool } from './crdbQuerierPool.js';

describeTextSearch('CockroachDB', () => new CrdbQuerierPool(cockroachConnection()));
