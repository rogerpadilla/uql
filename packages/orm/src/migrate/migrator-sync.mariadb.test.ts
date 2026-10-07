import { describeMigratorSync } from './migrator-sync-test.js';

describeMigratorSync('mariadb', {
  serialIdColumn: '`id` BIGINT AUTO_INCREMENT PRIMARY KEY',
  textType: 'VARCHAR(255)',
  doubleType: 'DOUBLE',
  keyColumnType: 'BIGINT',
  keepsComments: true,
});
