import { describeVectorTuning } from '../querier/vectorTuning-test.js';
import { postgresConnection } from '../test/index.js';
import { PgQuerierPool } from './pgQuerierPool.js';

describeVectorTuning('pgvector', () => new PgQuerierPool(postgresConnection('test_pg')));
