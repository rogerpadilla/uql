import { MariadbQuerierPool } from '../../maria/mariadbQuerierPool.js';
import { createSpec } from '../../test/index.js';
import { MariadbSchemaIntrospector } from '../introspection/mysqlIntrospector.js';
import { AlterCapableMigrationBuilderIt } from './abstractMigrationBuilder-test.js';

class MariadbMigrationBuilderIt extends AlterCapableMigrationBuilderIt {
  constructor() {
    const pool = new MariadbQuerierPool({
      host: '0.0.0.0',
      port: 3326,
      user: 'test',
      password: 'test',
      database: 'test',
      connectionLimit: 5,
    });
    super(pool, new MariadbSchemaIntrospector(pool));
  }
}

createSpec(new MariadbMigrationBuilderIt());
