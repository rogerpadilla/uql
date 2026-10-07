import { describeMigratorSync } from './migrator-sync-test.js';

describeMigratorSync('mysql', {
  serialIdColumn: '`id` BIGINT AUTO_INCREMENT PRIMARY KEY',
  textType: 'VARCHAR(255)',
  doubleType: 'DOUBLE',
  keyColumnType: 'BIGINT',
  keepsComments: true,
});
