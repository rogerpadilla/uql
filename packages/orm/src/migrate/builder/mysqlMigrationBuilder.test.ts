import { MySql2QuerierPool } from '../../mysql/mysql2QuerierPool.js';
import { createSpec, mysqlConnection } from '../../test/index.js';
import { AlterCapableMigrationBuilderIt } from './abstractMigrationBuilder-test.js';

class MysqlMigrationBuilderIt extends AlterCapableMigrationBuilderIt {}

createSpec(new MysqlMigrationBuilderIt(new MySql2QuerierPool(mysqlConnection('test_builder'))));
