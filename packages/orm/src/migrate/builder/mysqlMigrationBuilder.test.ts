import { MySql2QuerierPool } from '../../mysql/mysql2QuerierPool.js';
import { createSpec, mysqlConnection } from '../../test/index.js';
import { MysqlSchemaIntrospector } from '../introspection/mysqlIntrospector.js';
import { AlterCapableMigrationBuilderIt } from './abstractMigrationBuilder-test.js';

class MysqlMigrationBuilderIt extends AlterCapableMigrationBuilderIt {
  constructor() {
    const pool = new MySql2QuerierPool(mysqlConnection());
    super(pool, new MysqlSchemaIntrospector(pool));
  }
}

createSpec(new MysqlMigrationBuilderIt());
