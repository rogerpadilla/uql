import { expect } from 'vitest';
import { MsSqlQuerierPool } from '../../mssql/mssqlQuerierPool.js';
import type { ForeignKeyAction } from '../../schema/types.js';
import { createSpec, mssqlConnection } from '../../test/index.js';
import { AbstractIntrospectorIt, INTROSPECT_TABLES } from './abstractIntrospector-test.js';
import { MsSqlSchemaIntrospector } from './mssqlIntrospector.js';

class MsSqlIntrospectorIt extends AbstractIntrospectorIt {
  constructor() {
    const pool = new MsSqlQuerierPool(mssqlConnection('test_introspector'));
    super(pool, new MsSqlSchemaIntrospector(pool));
  }

  /** SQL Server takes no type on a computed column, and recomputes one per read unless told to persist it. */
  protected override virtualGeneratedColumn(): string {
    return 'doubled AS (qty * 2)';
  }

  /** A cascading self-reference is a cycle, which SQL Server refuses (error 1785). */
  protected override selfReferenceOnDelete(): ForeignKeyAction {
    return 'NO ACTION';
  }

  /** T-SQL has no `RESTRICT`; `NO ACTION` is the same immediate check. */
  protected override restrictOnDelete(): ForeignKeyAction {
    return 'NO ACTION';
  }

  /** `max_length` is bytes: two a character for an `N` type, and `-1` for `MAX`. */
  async shouldReadAWidthInCharacters() {
    const schema = await this.probe('probe_widths', (querier, table) =>
      querier.run(
        `CREATE TABLE ${table} (a NVARCHAR(255), b NVARCHAR(MAX), c VARCHAR(20), d NCHAR(10), e VARBINARY(16), f VARBINARY(MAX))`,
      ),
    );

    expect(schema.columns.map(({ name, type, length }) => ({ name, type, length }))).toEqual([
      { name: 'a', type: 'NVARCHAR', length: 255 },
      { name: 'b', type: 'NVARCHAR(MAX)', length: undefined },
      { name: 'c', type: 'VARCHAR', length: 20 },
      { name: 'd', type: 'NCHAR', length: 10 },
      { name: 'e', type: 'VARBINARY', length: 16 },
      { name: 'f', type: 'VARBINARY(MAX)', length: undefined },
    ]);
  }

  /** Read off the storage size, an 8-byte header and four a dimension: `vector_dimensions` is 2025-only. */
  async shouldReadAVectorDimensionFromItsStorageSize() {
    const schema = await this.probe('probe_vector', (querier, table) =>
      querier.run(`CREATE TABLE ${table} (embedding VECTOR(1536))`),
    );

    expect(this.getColumn(schema, 'embedding')).toMatchObject({ type: 'VECTOR', length: 1536 });
  }

  async shouldReadAPrecisionOnlyWhereTheTypeDeclaresOne() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    expect(this.getColumn(schema, 'amount')).toMatchObject({ precision: 10, scale: 2 });
    expect(this.getColumn(schema, 'score')).toMatchObject({ precision: undefined, scale: undefined });
  }

  async shouldReadEveryDefaultSpelling() {
    const schema = await this.probe('probe_defaults', (querier, table) =>
      querier.run(/*sql*/ `
        CREATE TABLE ${table} (
          quoted NVARCHAR(9) DEFAULT N'it''s', plain VARCHAR(9) DEFAULT 'x', negative INT DEFAULT -3,
          fraction DECIMAL(6, 2) DEFAULT -1.5, blank NVARCHAR(9) DEFAULT NULL, stamped DATETIME2 DEFAULT CURRENT_TIMESTAMP,
          summed INT DEFAULT (1) + (2), bare INT
        )
      `),
    );

    expect(Object.fromEntries(schema.columns.map((column) => [column.name, column.defaultValue]))).toEqual({
      quoted: "it's",
      plain: 'x',
      negative: -3,
      fraction: -1.5,
      blank: null,
      stamped: 'getdate()',
      summed: '(1)+(2)',
      bare: undefined,
    });
  }

  /** A table of the same name in the default schema is neither read nor in the way. */
  async shouldReadOnlyTheSchemaItWasGiven() {
    const table = `uql_probe.${INTROSPECT_TABLES.A}`;
    const querier = await this.pool.getQuerier();
    try {
      await querier.run('CREATE SCHEMA uql_probe');
      await querier.run(
        `CREATE TABLE ${table} (id INT CONSTRAINT probe_pk PRIMARY KEY, code INT UNIQUE, note NVARCHAR(9), INDEX probe_note_idx (note))`,
      );

      const named = await new MsSqlSchemaIntrospector(this.pool, 'uql_probe').getTableSchema(INTROSPECT_TABLES.A);
      const own = await this.getTableSchema(INTROSPECT_TABLES.A);

      expect(named).toMatchObject({ primaryKey: ['id'], primaryKeyName: 'probe_pk', foreignKeys: [] });
      expect(named?.indexes?.map((index) => index.name)).toContain('probe_note_idx');
      expect(named?.columns.map(({ name, isUnique }) => ({ name, isUnique }))).toEqual([
        { name: 'id', isUnique: false },
        { name: 'code', isUnique: true },
        { name: 'note', isUnique: false },
      ]);
      expect(own.columns.map((column) => column.name)).toContain('status');
    } finally {
      await querier.run(`DROP TABLE IF EXISTS ${table}`);
      await querier.run('DROP SCHEMA IF EXISTS uql_probe');
      await querier.release();
    }
  }

  async shouldEscapeTheSchemaItWasGiven() {
    await expect(new MsSqlSchemaIntrospector(this.pool, "uql'probe").getTableNames()).resolves.toEqual([]);
  }
}

createSpec(new MsSqlIntrospectorIt());
