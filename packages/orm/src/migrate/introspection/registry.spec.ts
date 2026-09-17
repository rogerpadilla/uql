import { describe, expect, it } from 'vitest';
import { CockroachDialect } from '../../cockroachdb/cockroachDialect.js';
import type { AbstractDialect } from '../../dialect/abstractDialect.js';
import { MariaDialect } from '../../maria/mariaDialect.js';
import { MongoDialect } from '../../mongo/mongoDialect.js';
import { MsSqlDialect } from '../../mssql/mssqlDialect.js';
import { MySqlDialect } from '../../mysql/mysqlDialect.js';
import { PostgresDialect } from '../../postgres/postgresDialect.js';
import { SqliteDialect } from '../../sqlite/sqliteDialect.js';
import { createMockQuerier, createMockQuerierPool } from '../../test/index.js';
import { MongoSchemaIntrospector } from './mongoIntrospector.js';
import { MsSqlSchemaIntrospector } from './mssqlIntrospector.js';
import { MariadbSchemaIntrospector, MysqlSchemaIntrospector } from './mysqlIntrospector.js';
import { CockroachSchemaIntrospector, PostgresSchemaIntrospector } from './postgresIntrospector.js';
import { introspectorFor } from './registry.js';
import { SqliteSchemaIntrospector } from './sqliteIntrospector.js';

describe('introspectorFor', () => {
  const poolOf = (dialect: AbstractDialect) => createMockQuerierPool(dialect, async () => createMockQuerier());

  it.each([
    { dialect: new PostgresDialect(), introspector: PostgresSchemaIntrospector },
    { dialect: new CockroachDialect(), introspector: CockroachSchemaIntrospector },
    { dialect: new MySqlDialect(), introspector: MysqlSchemaIntrospector },
    { dialect: new MariaDialect(), introspector: MariadbSchemaIntrospector },
    { dialect: new MsSqlDialect(), introspector: MsSqlSchemaIntrospector },
    { dialect: new SqliteDialect(), introspector: SqliteSchemaIntrospector },
    { dialect: new MongoDialect(), introspector: MongoSchemaIntrospector },
  ])('should build the introspector of the engine $dialect.dialectName', ({ dialect, introspector }) => {
    expect(introspectorFor(poolOf(dialect))).toBeInstanceOf(introspector);
  });

  it('should carry a named schema to an engine that has schemas, and not to one without', () => {
    expect(introspectorFor(poolOf(new MsSqlDialect()), 'crm')).toMatchObject({ schema: 'crm' });
    expect(introspectorFor(poolOf(new SqliteDialect()), 'crm')).toMatchObject({ schema: undefined });
  });
});
