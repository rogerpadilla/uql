import { MariadbQuerierPool } from '../../maria/mariadbQuerierPool.js';
import { createSpec, mariadbConnection } from '../../test/index.js';
import { MariadbSchemaIntrospector } from '../introspection/mysqlIntrospector.js';
import { AlterCapableMigrationBuilderIt } from './abstractMigrationBuilder-test.js';

class MariadbMigrationBuilderIt extends AlterCapableMigrationBuilderIt {
  constructor() {
    const pool = new MariadbQuerierPool(mariadbConnection());
    super(pool, new MariadbSchemaIntrospector(pool));
  }
}

createSpec(new MariadbMigrationBuilderIt());
