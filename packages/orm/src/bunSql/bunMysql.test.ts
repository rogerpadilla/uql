import { SqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { MySqlQuerierIt } from '../querier/mysqlLikeQuerier-test.js';
import { createSpec } from '../test/index.js';
import { BunSqlQuerierPool } from './bunSqlQuerierPool.js';

// MySQL 9 authenticates with `caching_sha2_password`, whose first handshake for a user needs the
// server's RSA key, and Bun 1.4 refuses to fetch one over a plaintext socket. The alternative is TLS
// on a throwaway local container. Not a URL parameter: Bun ignores it there.
const config = () => ({ url: 'mysql://test:test@0.0.0.0:3316/test_bun_mysql', allowPublicKeyRetrieval: true });

createSpec(new MySqlQuerierIt(new BunSqlQuerierPool(config())));
createSpec(new SqlQuerierPoolIt(() => new BunSqlQuerierPool(config())));
