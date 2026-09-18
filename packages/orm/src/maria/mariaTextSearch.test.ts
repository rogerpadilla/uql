import { describeTextSearch } from '../querier/textSearch-test.js';
import { mariadbConnection } from '../test/index.js';
import { MariadbQuerierPool } from './mariadbQuerierPool.js';

describeTextSearch('MariaDB', () => new MariadbQuerierPool(mariadbConnection()));
