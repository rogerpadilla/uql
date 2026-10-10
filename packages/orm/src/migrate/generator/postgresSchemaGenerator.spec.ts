import { describe, expect, it } from 'vitest';
import { CockroachDialect } from '../../cockroachdb/cockroachDialect.js';
import { PostgresDialect } from '../../postgres/postgresDialect.js';
import { sqlTypeOf } from '../../test/index.js';
import { currentTimestamp } from '../../util/sql.js';
import { tableDdlFor } from '../ddl/index.js';
import { reverseDiff } from '../schemaChange.js';
import { SqlSchemaGenerator } from '../schemaGenerator.js';

describe('PostgresSchemaGenerator Specifics', () => {
  const dialect = new PostgresDialect();
  const generator = new SqlSchemaGenerator(dialect);
  const tableDdl = tableDdlFor(new PostgresDialect());

  it('should map column types correctly', () => {
    expect(sqlTypeOf(dialect, { type: String, length: 100 })).toBe('VARCHAR(100)');
    expect(sqlTypeOf(dialect, { type: String })).toBe('TEXT');
    expect(sqlTypeOf(dialect, { columnType: 'varchar', length: 100 })).toBe('VARCHAR(100)');
    expect(sqlTypeOf(dialect, { columnType: 'varchar' })).toBe('TEXT');
    expect(sqlTypeOf(dialect, { columnType: 'text' })).toBe('TEXT');
    expect(sqlTypeOf(dialect, { columnType: 'int' })).toBe('INTEGER');
    expect(sqlTypeOf(dialect, { columnType: 'bigint' })).toBe('BIGINT');
    expect(sqlTypeOf(dialect, { type: Boolean })).toBe('BOOLEAN');
    expect(sqlTypeOf(dialect, { columnType: 'decimal', precision: 10, scale: 2 })).toBe('NUMERIC(10, 2)');
  });

  it('should generate DROP INDEX statement', () => {
    expect(generator.generateOperation({ type: 'dropIndex', tableName: 'users', indexName: 'test_idx' })).toEqual([
      'DROP INDEX IF EXISTS "test_idx";',
    ]);
  });

  it('should generate ALTER COLUMN statements', () => {
    const col = {
      name: 'age',
      type: 'INTEGER',
      nullable: false,
      defaultValue: 18,
      isPrimaryKey: false,
      isAutoIncrement: false,
      isUnique: false,
    };
    expect(tableDdl.alterColumns('users', [{ to: col }])).toEqual([
      'ALTER TABLE "users" ALTER COLUMN "age" TYPE INTEGER USING "age"::INTEGER, ALTER COLUMN "age" SET NOT NULL, ' +
        'ALTER COLUMN "age" SET DEFAULT 18;',
    ]);
  });

  /** Postgres alters each part apart, so a part unchanged as the engine reprints it is not restated. */
  it('should alter only what changed in a column, both ways', () => {
    const from = {
      name: 'createdAt',
      type: 'TIMESTAMP',
      nullable: true,
      defaultValue: currentTimestamp,
      isPrimaryKey: false,
      isAutoIncrement: false,
      isUnique: false,
    };
    const diff = {
      tableName: 'users',
      type: 'alter' as const,
      columns: [{ from, to: { ...from, type: 'TIMESTAMPTZ', defaultValue: currentTimestamp } }],
    };

    expect(generator.generateAlterTable(diff)).toEqual([
      'ALTER TABLE "users" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ USING "createdAt"::TIMESTAMPTZ;',
    ]);
    expect(generator.generateAlterTable(reverseDiff(diff))).toEqual([
      'ALTER TABLE "users" ALTER COLUMN "createdAt" TYPE TIMESTAMP USING "createdAt"::TIMESTAMP;',
    ]);
  });

  /** Postgres casts text to integer only when told to, so a retype without `USING` fails on any row. */
  it('should cast the values of a retyped column', () => {
    const from = {
      name: 'age',
      type: 'TEXT',
      nullable: true,
      isPrimaryKey: false,
      isAutoIncrement: false,
      isUnique: false,
    };
    const diff = { tableName: 'users', type: 'alter' as const, columns: [{ from, to: { ...from, type: 'INTEGER' } }] };

    expect(generator.generateAlterTable(diff)).toEqual([
      'ALTER TABLE "users" ALTER COLUMN "age" TYPE INTEGER USING "age"::INTEGER;',
    ]);
  });

  /** Postgres rewrites the table once a statement, so one statement for a table's alters is one rewrite. */
  it("should alter a table's columns in one statement", () => {
    const age = {
      name: 'age',
      type: 'TEXT',
      nullable: true,
      isPrimaryKey: false,
      isAutoIncrement: false,
      isUnique: false,
    };
    const rank = { ...age, name: 'rank' };
    const diff = {
      tableName: 'users',
      type: 'alter' as const,
      columns: [
        { from: age, to: { ...age, type: 'INTEGER' } },
        { from: rank, to: { ...rank, type: 'INTEGER', nullable: false } },
      ],
    };

    expect(generator.generateAlterTable(diff)).toEqual([
      'ALTER TABLE "users" ALTER COLUMN "age" TYPE INTEGER USING "age"::INTEGER, ' +
        'ALTER COLUMN "rank" TYPE INTEGER USING "rank"::INTEGER, ALTER COLUMN "rank" SET NOT NULL;',
    ]);
    // CockroachDB refuses a rewriting retype beside any other clause, and changes a schema online anyway.
    expect(new SqlSchemaGenerator(new CockroachDialect()).generateAlterTable(diff)).toEqual([
      'ALTER TABLE "users" ALTER COLUMN "age" TYPE INTEGER USING "age"::INTEGER;',
      'ALTER TABLE "users" ALTER COLUMN "rank" TYPE INTEGER USING "rank"::INTEGER;',
      'ALTER TABLE "users" ALTER COLUMN "rank" SET NOT NULL;',
    ]);
  });
});
