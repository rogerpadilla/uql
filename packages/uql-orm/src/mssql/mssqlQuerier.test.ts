import { AbstractSqlQuerierIt } from '../querier/abstractSqlQuerier-test.js';
import { createSpec } from '../test/index.js';
import { MsSqlQuerierPool } from './mssqlQuerierPool.js';

/** Integration suite against a live SQL Server, run by `bun run test` with every other engine's. */
class MsSqlQuerierIt extends AbstractSqlQuerierIt {
  constructor() {
    super(
      new MsSqlQuerierPool({
        server: 'localhost',
        port: 1434,
        user: 'sa',
        password: 'test!Test',
        database: 'test',
        options: { trustServerCertificate: true, encrypt: false },
      }),
    );
  }
}

createSpec(new MsSqlQuerierIt());
