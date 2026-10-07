import { PgLikeQuerierIt } from '../querier/pgLikeQuerier-test.js';
import { cockroachConnection, createSpec } from '../test/index.js';
import { CrdbQuerierPool } from './crdbQuerierPool.js';

createSpec(new PgLikeQuerierIt(new CrdbQuerierPool(cockroachConnection('test_crdb'))));
