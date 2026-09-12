import { MsSqlDialect } from '../mssql/mssqlDialect.js';
import { MsSqlQuerierPool } from '../mssql/mssqlQuerierPool.js';
import { mssqlConnection } from '../test/index.js';
import { MsSqlSchemaIntrospector } from './introspection/mssqlIntrospector.js';
import { describeMigratorSync } from './migrator-sync-test.js';

describeMigratorSync({
  name: 'MSSQL',
  createPool: () => new MsSqlQuerierPool(mssqlConnection('test_sync')),
  createIntrospector: (pool) => new MsSqlSchemaIntrospector(pool),
  dialect: new MsSqlDialect({}),
  serialIdColumn: '"id" BIGINT IDENTITY(1,1) PRIMARY KEY',
  textType: 'NVARCHAR(255)',
  doubleType: 'FLOAT',
  keyColumnType: 'BIGINT',
});
