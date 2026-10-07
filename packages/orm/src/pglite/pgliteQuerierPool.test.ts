import { SqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { createSpec } from '../test/index.js';
import { PgliteQuerierPool } from './pgliteQuerierPool.js';

createSpec(new SqlQuerierPoolIt(() => new PgliteQuerierPool('memory://')));
