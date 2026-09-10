import { describe, expect, it } from 'vitest';
import { MsSqlDialect } from '../../mssql/mssqlDialect.js';
import { PostgresDialect } from '../../postgres/postgresDialect.js';
import type { QuerierPool } from '../../type/index.js';
import { MsSqlSchemaIntrospector } from './mssqlIntrospector.js';
import { PostgresSchemaIntrospector } from './postgresIntrospector.js';
import { introspectorFor } from './registry.js';

describe('introspectorFor', () => {
  const poolOf = (dialect: unknown) => ({ dialect }) as QuerierPool;

  it('should build the introspector each engine names', () => {
    expect(introspectorFor('mssql', poolOf(new MsSqlDialect({})))).toBeInstanceOf(MsSqlSchemaIntrospector);
    expect(introspectorFor('postgres', poolOf(new PostgresDialect({})))).toBeInstanceOf(PostgresSchemaIntrospector);
  });

  it('should carry a named schema through to the introspector', () => {
    const introspector = introspectorFor('mssql', poolOf(new MsSqlDialect({})), 'crm');

    expect(introspector).toBeInstanceOf(MsSqlSchemaIntrospector);
    expect((introspector as MsSqlSchemaIntrospector).schema).toBe('crm');
  });

  /** An engine the migrator has no catalogue queries for gets no introspector rather than a wrong one. */
  it('should answer nothing for an engine it does not know', () => {
    expect(introspectorFor('duckdb', poolOf(new MsSqlDialect({})))).toBeUndefined();
  });
});
