import { MySqlLikeQuerierIt } from '../querier/mysqlLikeQuerier-test.js';
import { createSpec } from '../test/index.js';
import { BunSqlQuerierPool } from './bunSqlQuerierPool.js';

class BunMysqlIt extends MySqlLikeQuerierIt {
  constructor() {
    super(
      new BunSqlQuerierPool({
        url: 'mysql://test:test@0.0.0.0:3316/test_bun_mysql',
        // MySQL 9 authenticates with `caching_sha2_password`, whose first handshake for a user needs
        // the server's RSA key, and Bun 1.4 refuses to fetch one over a plaintext socket. The
        // alternative is TLS on a throwaway local container. Not a URL parameter: Bun ignores it there.
        allowPublicKeyRetrieval: true,
      }),
    );
  }
}

createSpec(new BunMysqlIt());
