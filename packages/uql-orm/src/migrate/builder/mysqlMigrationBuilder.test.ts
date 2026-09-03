import { MySql2QuerierPool } from '../../mysql/mysql2QuerierPool.js';
import { createSpec } from '../../test/index.js';
import { MysqlSchemaIntrospector } from '../introspection/mysqlIntrospector.js';
import { AlterCapableMigrationBuilderIt } from './abstractMigrationBuilder-test.js';

class MysqlMigrationBuilderIt extends AlterCapableMigrationBuilderIt {
  constructor() {
    const pool = new MySql2QuerierPool({
      host: '0.0.0.0',
      port: 3316,
      user: 'test',
      password: 'test',
      database: 'test',
    });
    super(pool, new MysqlSchemaIntrospector(pool));
  }
}

createSpec(new MysqlMigrationBuilderIt());
