import { MsSqlQuerierPool } from '../../mssql/mssqlQuerierPool.js';
import { createSpec } from '../../test/index.js';
import { MsSqlSchemaIntrospector } from '../introspection/mssqlIntrospector.js';
import { AlterCapableMigrationBuilderIt } from './abstractMigrationBuilder-test.js';

class MsSqlMigrationBuilderIt extends AlterCapableMigrationBuilderIt {
  constructor() {
    const pool = new MsSqlQuerierPool({
      server: 'localhost',
      port: 1434,
      user: 'sa',
      password: 'test!Test',
      database: 'test',
      options: { trustServerCertificate: true, encrypt: false },
    });
    super(pool, new MsSqlSchemaIntrospector(pool));
  }
}

createSpec(new MsSqlMigrationBuilderIt());
