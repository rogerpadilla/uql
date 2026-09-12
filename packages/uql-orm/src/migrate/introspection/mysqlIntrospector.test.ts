import { MySql2QuerierPool } from '../../mysql/mysql2QuerierPool.js';
import { createSpec, mysqlConnection } from '../../test/index.js';
import { MySqlFamilyIntrospectorIt } from './mysqlFamilyIntrospector-test.js';
import { MysqlSchemaIntrospector } from './mysqlIntrospector.js';

class MysqlIntrospectorIt extends MySqlFamilyIntrospectorIt {
  constructor() {
    const pool = new MySql2QuerierPool(mysqlConnection());
    super(pool, new MysqlSchemaIntrospector(pool));
  }
}

createSpec(new MysqlIntrospectorIt());
