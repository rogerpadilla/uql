import { SqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { SqliteLikeQuerierIt } from '../querier/sqliteLikeQuerier-test.js';
import { createSpec, libsqlServerUrl } from '../test/index.js';
import { LibsqlQuerierPool } from './libsqlQuerierPool.js';

// libSQL over HTTP, as a remote database is reached: each transaction on a stream of its own.
createSpec(new SqliteLikeQuerierIt(new LibsqlQuerierPool({ url: libsqlServerUrl })));
createSpec(new SqlQuerierPoolIt(() => new LibsqlQuerierPool({ url: libsqlServerUrl })));
