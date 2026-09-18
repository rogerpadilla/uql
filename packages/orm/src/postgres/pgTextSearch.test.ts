import { describeTextSearch } from '../querier/textSearch-test.js';
import { postgresConnection } from '../test/index.js';
import { PgQuerierPool } from './pgQuerierPool.js';

describeTextSearch('PostgreSQL', () => new PgQuerierPool(postgresConnection('test_pg')));
