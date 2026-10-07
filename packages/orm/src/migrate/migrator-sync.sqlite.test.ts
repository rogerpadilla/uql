import { describeMigratorSync } from './migrator-sync-test.js';

describeMigratorSync('sqlite', {
  serialIdColumn: '`id` INTEGER PRIMARY KEY AUTOINCREMENT',
  textType: 'TEXT',
  doubleType: 'DOUBLE',
  keyColumnType: 'INTEGER',
  keepsComments: false,
});
