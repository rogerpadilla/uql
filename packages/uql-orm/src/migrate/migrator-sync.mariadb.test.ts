import { MariaDialect } from '../maria/mariaDialect.js';
import { MariadbQuerierPool } from '../maria/mariadbQuerierPool.js';
import { mariadbConnection } from '../test/index.js';
import { MariadbSchemaIntrospector } from './introspection/mysqlIntrospector.js';
import { describeMigratorSync } from './migrator-sync-test.js';

describeMigratorSync({
  name: 'MariaDB',
  legacyUnsignedIdColumn: '`id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY',
  createPool: () => new MariadbQuerierPool(mariadbConnection()),
  createIntrospector: (pool) => new MariadbSchemaIntrospector(pool),
  dialect: new MariaDialect(),
  serialIdColumn: '`id` BIGINT AUTO_INCREMENT PRIMARY KEY',
  textType: 'VARCHAR(255)',
  doubleType: 'DOUBLE',
  keyColumnType: 'BIGINT',
});
