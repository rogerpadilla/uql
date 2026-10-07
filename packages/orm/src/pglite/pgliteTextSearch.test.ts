import { describeTextSearch } from '../querier/textSearch-test.js';
import { PgliteQuerierPool } from './pgliteQuerierPool.js';

describeTextSearch('PGlite', () => new PgliteQuerierPool('memory://'));
