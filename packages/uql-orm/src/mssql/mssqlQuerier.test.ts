import { VectorQuerierIt } from '../querier/vectorQuerier-test.js';
import { createSpec } from '../test/index.js';
import { MsSqlQuerierPool } from './mssqlQuerierPool.js';

/** Integration suite against a live SQL Server, run by `bun run test` with every other engine's. */
class MsSqlQuerierIt extends VectorQuerierIt {
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

  /** A bare literal that wide is NUMERIC on SQL Server, which `tedious` reads as a float. */
  protected override wideIntegerSql() {
    return 'SELECT CAST(9007199254740993 AS BIGINT) AS big';
  }
}

createSpec(new MsSqlQuerierIt());
