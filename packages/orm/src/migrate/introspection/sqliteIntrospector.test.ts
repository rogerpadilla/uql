import { expect, vi } from 'vitest';
import { SqlExpression } from '../../schema/sqlExpression.js';
import type { TypeCategory } from '../../schema/types.js';
import { Sqlite3QuerierPool } from '../../sqlite/sqliteQuerierPool.js';
import { createMockQuerier, createMockQuerierPool, createSpec } from '../../test/index.js';
import { UqlUsageError } from '../../util/uqlError.js';
import { AbstractIntrospectorIt, INTROSPECT_TABLES } from './abstractIntrospector-test.js';
import { SqliteSchemaIntrospector } from './sqliteIntrospector.js';

class SqliteIntrospectorIt extends AbstractIntrospectorIt {
  constructor() {
    const pool = new Sqlite3QuerierPool(':memory:');
    super(pool, new SqliteSchemaIntrospector(pool));
  }

  /** SQLite has no date/time type: a timestamp is stored, and read back, as `TEXT`. */
  protected override expectedTimestampCategory(): TypeCategory {
    return 'string';
  }

  async shouldIntrospectIntegerPrimaryKeyAsAutoIncrement() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const idCol = this.getColumn(schema, 'id');
    expect(idCol.isPrimaryKey).toBe(true);
    expect(idCol.isAutoIncrement).toBe(true);
  }

  /**
   * `PRAGMA index_info` names an expression entry `null`, and only `sqlite_master.sql` holds its text,
   * so such an index is left out rather than reported over a column called `null`.
   */
  async shouldSkipAnExpressionIndexRatherThanNameItNull() {
    const querier = await this.pool.getQuerier();
    try {
      const table = querier.dialect.escapeId(INTROSPECT_TABLES.A);
      await querier.run(`CREATE INDEX expr_name_idx ON ${table} (lower(${querier.dialect.escapeId('name')}))`);

      const schema = await this.getTableSchema(INTROSPECT_TABLES.A);
      const names = schema.indexes?.map((index) => index.name) ?? [];

      expect(names).not.toContain('expr_name_idx');
      expect(schema.indexes?.flatMap((index) => index.entries.map((column) => column.column))).not.toContain(null);
    } finally {
      await querier.run('DROP INDEX expr_name_idx');
      await querier.release();
    }
  }

  /** Columns and key both read `table_info`, indexes and uniqueness both walk `index_list`: each is sent once. */
  async shouldSendEachIntrospectionStatementOnce() {
    const querier = await this.pool.getQuerier();
    const all = vi.spyOn(querier, 'all');
    const pool = createMockQuerierPool(this.pool.dialect, async () => querier);

    await new SqliteSchemaIntrospector(pool).getTableSchema(INTROSPECT_TABLES.A);

    const sent = all.mock.calls.map(([sql]) => sql);
    expect(sent.length).toBe(new Set(sent).size);
  }

  async shouldRefuseAPoolWhoseQuerierIsNotSql() {
    const pool = createMockQuerierPool(this.pool.dialect, async () => createMockQuerier());

    await expect(new SqliteSchemaIntrospector(pool).getTableNames()).rejects.toThrow(
      'SqliteSchemaIntrospector requires a SQL-based querier',
    );
    await expect(new SqliteSchemaIntrospector(pool).getTableNames()).rejects.toThrow(UqlUsageError);
  }

  async shouldIntrospectTextDefault() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const statusCol = this.getColumn(schema, 'status');
    expect(statusCol.type).toBe('TEXT');
    expect(statusCol.defaultValue).toBe('active');
  }

  async shouldIntrospectIntegerDefault() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const isEnabledCol = this.getColumn(schema, 'is_enabled');
    expect(isEnabledCol.type).toBe('INTEGER');
    expect(isEnabledCol.defaultValue).toBe(1);
  }

  async shouldIntrospectTimestampAsText() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const createdAtCol = this.getColumn(schema, 'created_at');
    expect(createdAtCol.type).toBe('TEXT');
    expect(createdAtCol.defaultValue).toEqual(new SqlExpression('currentTimestamp'));
  }

  /**
   * A boolean is stored as 0/1, so `TRUE`/`FALSE` read back as those numbers. The clock uql declares reads
   * back as the clock; SQLite's own `CURRENT_TIMESTAMP`, whole seconds in other text, is other SQL.
   */
  async shouldReadEveryDefaultSpelling() {
    const schema = await this.probe('probe_defaults', (querier, table) =>
      querier.run(/*sql*/ `
        CREATE TABLE ${table} (
          blank TEXT DEFAULT NULL, today TEXT DEFAULT CURRENT_DATE, word TEXT DEFAULT 'x',
          quoted TEXT DEFAULT 'it''s', negative INTEGER DEFAULT -3, fraction REAL DEFAULT 1.5,
          truthy INTEGER DEFAULT TRUE, falsy INTEGER DEFAULT false, computed TEXT DEFAULT (lower('Y')), bare TEXT,
          clock TEXT DEFAULT CURRENT_TIMESTAMP,
          dated TEXT DEFAULT (strftime('%Y-%m-%d 00:00:00.000', 'now')), spelled TEXT DEFAULT 'CURRENT_TIMESTAMP'
        )
      `),
    );

    expect(Object.fromEntries(schema.columns.map((column) => [column.name, column.defaultValue]))).toEqual({
      blank: null,
      today: new SqlExpression('raw', '(CURRENT_DATE)'),
      word: 'x',
      quoted: "it's",
      negative: -3,
      fraction: 1.5,
      truthy: 1,
      falsy: 0,
      computed: new SqlExpression('raw', "(lower('Y'))"),
      bare: undefined,
      clock: new SqlExpression('raw', '(CURRENT_TIMESTAMP)'),
      dated: new SqlExpression('currentDate'),
      spelled: 'CURRENT_TIMESTAMP',
    });
  }

  async shouldReadADeclaredTypeWithoutItsLength() {
    const schema = await this.probe('probe_types', (querier, table) =>
      querier.run(`CREATE TABLE ${table} (untyped, code VARCHAR(12))`),
    );

    expect(schema.columns.map(({ name, type, length }) => ({ name, type, length }))).toEqual([
      { name: 'untyped', type: '', length: undefined },
      { name: 'code', type: 'VARCHAR', length: 12 },
    ]);
  }

  /** The key's own index is not reported, a composite `UNIQUE` is, and only a sole column is `isUnique`. */
  async shouldReportTheIndexesATableDeclares() {
    const schema = await this.probe('probe_indexes', async (querier, table) => {
      await querier.run(`CREATE TABLE ${table} (code TEXT PRIMARY KEY, v TEXT, w TEXT UNIQUE, UNIQUE (v, w))`);
      await querier.run(`CREATE INDEX probe_indexes_v_idx ON ${table} (v)`);
    });

    // Each unique constraint's index, a one-column one too, as every engine reports it; never the key's.
    expect(schema.indexes).toEqual([
      { name: 'probe_indexes_v_idx', entries: [{ column: 'v' }], unique: false },
      { name: 'sqlite_autoindex_probe_indexes_3', entries: [{ column: 'v' }, { column: 'w' }], unique: true },
      { name: 'sqlite_autoindex_probe_indexes_2', entries: [{ column: 'w' }], unique: true },
    ]);
    expect(schema.columns.map(({ name, isUnique }) => ({ name, isUnique }))).toEqual([
      { name: 'code', isUnique: false },
      { name: 'v', isUnique: false },
      { name: 'w', isUnique: true },
    ]);
  }

  /** SQLite reports no foreign key's name, so the table leaves it out and the AST derives it from the columns. */
  async shouldDeriveAForeignKeyNameFromItsColumns() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.B);
    const ast = await this.introspector.introspect([INTROSPECT_TABLES.A, INTROSPECT_TABLES.B]);

    expect(this.getForeignKey(schema, 'a_id').name).toBe(undefined);
    expect(ast.getTable(INTROSPECT_TABLES.B)?.outgoingRelations.map((relation) => relation.name)).toEqual([
      `${INTROSPECT_TABLES.B}__a_id_fk`,
    ]);
  }

  /** A trigger written by hand is left alone: only the ones under uql's own prefix are reported, to reconcile. */
  async shouldReportOnlyTheTriggersUqlInstalled() {
    const table = 'probe_triggers';
    const body = `AFTER UPDATE ON ${table} BEGIN SELECT 1; END`;
    const run = (sql: string) => this.pool.withQuerier((querier) => querier.run(sql));
    await run(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, n INTEGER)`);
    try {
      await run(`CREATE TRIGGER hand_made ${body}`);
      await run(`CREATE TRIGGER _uql_probe_triggers__mine ${body}`);

      expect([...(await this.introspector.ownedTriggers(table)).entries()]).toEqual([
        ['_uql_probe_triggers__mine', [`CREATE TRIGGER _uql_probe_triggers__mine ${body}`]],
      ]);
    } finally {
      await run(`DROP TABLE ${table}`);
    }
  }

  async shouldReadATableWhoseNameNeedsEscaping() {
    const table = 'probe`quoted';
    const schema = await this.probe(table, (querier, escapedTable) =>
      querier.run(`CREATE TABLE ${escapedTable} (id INTEGER PRIMARY KEY)`),
    );

    expect(schema).toMatchObject({ name: table, primaryKey: { columns: ['id'] } });
  }
}

createSpec(new SqliteIntrospectorIt());
