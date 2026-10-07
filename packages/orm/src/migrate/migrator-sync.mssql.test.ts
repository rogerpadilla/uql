import { describeMigratorSync } from './migrator-sync-test.js';

describeMigratorSync('mssql', {
  serialIdColumn: '"id" BIGINT IDENTITY(1,1) PRIMARY KEY',
  textType: 'NVARCHAR(255)',
  doubleType: 'FLOAT',
  keyColumnType: 'BIGINT',
  keepsComments: false,
});
