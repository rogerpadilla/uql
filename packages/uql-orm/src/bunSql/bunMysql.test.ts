import { AbstractSqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { MySqlLikeQuerierIt } from '../querier/mysqlLikeQuerier-test.js';
import { createSpec } from '../test/index.js';
import type { BunSqlQuerier } from './bunSqlQuerier.js';
import { BunSqlQuerierPool } from './bunSqlQuerierPool.js';

// MySQL 9 authenticates with `caching_sha2_password`, whose first handshake for a user needs the
// server's RSA key, and Bun 1.4 refuses to fetch one over a plaintext socket. The alternative is TLS
// on a throwaway local container. Not a URL parameter: Bun ignores it there.
const config = {
  url: 'mysql://test:test@0.0.0.0:3316/test_bun_mysql',
  allowPublicKeyRetrieval: true,
};

class BunMysqlIt extends MySqlLikeQuerierIt {
  constructor() {
    super(new BunSqlQuerierPool(config));
  }
}

class BunMysqlPoolIt extends AbstractSqlQuerierPoolIt<BunSqlQuerier> {
  constructor() {
    super(new BunSqlQuerierPool(config));
  }
}

createSpec(new BunMysqlIt());
createSpec(new BunMysqlPoolIt());
