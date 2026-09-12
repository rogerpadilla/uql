import { MySql2QuerierPool } from '../mysql/mysql2QuerierPool.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { mysqlConnection } from '../test/index.js';
import { MysqlSchemaIntrospector } from './introspection/mysqlIntrospector.js';
import { describeMigratorSync } from './migrator-sync-test.js';

describeMigratorSync({
  name: 'MySQL',
  legacyUnsignedIdColumn: '`id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY',
  createPool: () => new MySql2QuerierPool(mysqlConnection()),
  createIntrospector: (pool) => new MysqlSchemaIntrospector(pool),
  dialect: new MySqlDialect(),
  serialIdColumn: '`id` BIGINT AUTO_INCREMENT PRIMARY KEY',
  textType: 'VARCHAR(255)',
  doubleType: 'DOUBLE',
  keyColumnType: 'BIGINT',
});
