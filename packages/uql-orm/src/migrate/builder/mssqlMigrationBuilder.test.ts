import { MsSqlQuerierPool } from '../../mssql/mssqlQuerierPool.js';
import { createSpec, mssqlConnection } from '../../test/index.js';
import { MsSqlSchemaIntrospector } from '../introspection/mssqlIntrospector.js';
import { AlterCapableMigrationBuilderIt } from './abstractMigrationBuilder-test.js';

class MsSqlMigrationBuilderIt extends AlterCapableMigrationBuilderIt {
  constructor() {
    const pool = new MsSqlQuerierPool(mssqlConnection('test_builder'));
    super(pool, new MsSqlSchemaIntrospector(pool));
  }
}

createSpec(new MsSqlMigrationBuilderIt());
