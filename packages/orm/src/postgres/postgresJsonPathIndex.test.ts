import { JsonPathIndexIt } from '../querier/jsonPathIndex-test.js';
import { createSpec, postgresConnection } from '../test/index.js';
import { PgQuerierPool } from './pgQuerierPool.js';

createSpec(new JsonPathIndexIt(new PgQuerierPool(postgresConnection())));
