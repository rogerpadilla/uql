import { PostgresQuerierIt } from '../querier/postgresQuerier-test.js';
import { createSpec, postgresConnection } from '../test/index.js';
import { PgQuerierPool } from './pgQuerierPool.js';

createSpec(new PostgresQuerierIt(new PgQuerierPool(postgresConnection('test_pg'))));
