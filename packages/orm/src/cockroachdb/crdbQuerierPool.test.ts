import { SqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { cockroachConnection, createSpec } from '../test/index.js';
import { CrdbQuerierPool } from './crdbQuerierPool.js';

createSpec(new SqlQuerierPoolIt(() => new CrdbQuerierPool(cockroachConnection())));
