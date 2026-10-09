import { describeTextSearch } from '../querier/textSearch-test.js';
import { describeLoadedTextWeights } from '../querier/textWeights-test.js';
import { mariadbConnection } from '../test/index.js';
import { MariadbQuerierPool } from './mariadbQuerierPool.js';

describeTextSearch('MariaDB', () => new MariadbQuerierPool(mariadbConnection()));
describeLoadedTextWeights('MariaDB', () => new MariadbQuerierPool(mariadbConnection()));
