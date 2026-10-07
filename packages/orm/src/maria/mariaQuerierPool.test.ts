import { SqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { createSpec, mariadbConnection } from '../test/index.js';
import { MariadbQuerierPool } from './mariadbQuerierPool.js';

createSpec(new SqlQuerierPoolIt(() => new MariadbQuerierPool({ ...mariadbConnection(), trace: true })));
