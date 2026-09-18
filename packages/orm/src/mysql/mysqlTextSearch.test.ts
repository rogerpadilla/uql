import { describeTextSearch } from '../querier/textSearch-test.js';
import { describeLoadedTextWeights } from '../querier/textWeights-test.js';
import { mysqlConnection } from '../test/index.js';
import { MySql2QuerierPool } from './mysql2QuerierPool.js';

describeTextSearch('MySQL', () => new MySql2QuerierPool(mysqlConnection()));
describeLoadedTextWeights('MySQL', () => new MySql2QuerierPool(mysqlConnection()));
