import { PgQuerierPool } from '../../postgres/pgQuerierPool.js';
import { createSpec } from '../../test/index.js';
import { PostgresSchemaIntrospector } from '../introspection/postgresIntrospector.js';
import { AlterCapableMigrationBuilderIt } from './abstractMigrationBuilder-test.js';

class PostgresMigrationBuilderIt extends AlterCapableMigrationBuilderIt {
  constructor() {
    const pool = new PgQuerierPool({
      host: '0.0.0.0',
      port: 5442,
      user: 'test',
      password: 'test',
      database: 'test',
    });
    super(pool, new PostgresSchemaIntrospector(pool));
  }
}

createSpec(new PostgresMigrationBuilderIt());
