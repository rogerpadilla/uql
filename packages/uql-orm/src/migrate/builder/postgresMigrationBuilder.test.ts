import { PgQuerierPool } from '../../postgres/pgQuerierPool.js';
import { createSpec, postgresConnection } from '../../test/index.js';
import { PostgresSchemaIntrospector } from '../introspection/postgresIntrospector.js';
import { AlterCapableMigrationBuilderIt } from './abstractMigrationBuilder-test.js';

class PostgresMigrationBuilderIt extends AlterCapableMigrationBuilderIt {
  constructor() {
    const pool = new PgQuerierPool(postgresConnection());
    super(pool, new PostgresSchemaIntrospector(pool));
  }
}

createSpec(new PostgresMigrationBuilderIt());
