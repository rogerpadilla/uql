import { MsSqlQuerierPool } from '../../mssql/mssqlQuerierPool.js';
import type { ForeignKeyAction } from '../../schema/types.js';
import { createSpec } from '../../test/index.js';
import { AbstractIntrospectorIt } from './abstractIntrospector-test.js';
import { MsSqlSchemaIntrospector } from './mssqlIntrospector.js';

class MsSqlIntrospectorIt extends AbstractIntrospectorIt {
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

  /** A cascading self-reference is a cycle, which SQL Server refuses (error 1785). */
  protected override selfReferenceOnDelete(): ForeignKeyAction {
    return 'NO ACTION';
  }

  /** T-SQL has no `RESTRICT`; `NO ACTION` is the same immediate check. */
  protected override restrictOnDelete(): ForeignKeyAction {
    return 'NO ACTION';
  }
}

createSpec(new MsSqlIntrospectorIt());
