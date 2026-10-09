import { expect, vi } from 'vitest';
import { SqlExpression } from '../../schema/sqlExpression.js';
import { SqliteQuerierPool } from '../../sqlite/sqliteQuerierPool.js';
import { createMockQuerierPool, createSpec, sentStatements } from '../../test/index.js';
import { raw } from '../../util/raw.js';
import { AbstractIntrospectorIt, INTROSPECT_TABLES } from './abstractIntrospector-test.js';
import { SqliteSchemaIntrospector } from './sqliteIntrospector.js';

class SqliteIntrospectorIt extends AbstractIntrospectorIt {
  /** A string is `TEXT`, which keeps no length. */
  override requirements() {
    return { ...super.requirements(), shouldIntrospectVarcharLength: false };
  }

  /** None: SQLite stores a decimal as `REAL`. */
  protected override expectedDecimalBounds() {
    return [undefined, undefined];
  }

  /** A boolean is stored as 0/1. */
  protected override expectedTrueDefault() {
    return 1;
  }

  /** `PRAGMA index_info` names an expression entry `null`: it is reported as an expression, not a column called `null`. */
  async shouldReportAnExpressionEntryAsAnExpression() {
    const schema = await this.probe('probe_expression', async (querier, table) => {
      await querier.run(raw.text(`CREATE TABLE ${table} (name TEXT)`));
      await querier.run(raw.text(`CREATE INDEX probe_lower_idx ON ${table} (lower(name))`));
    });

    expect(schema.indexes).toEqual([
      { name: 'probe_lower_idx', unique: false, entries: [{ column: '', expression: true }] },
    ]);
  }

  /** Columns and key both read `table_info`: each statement is sent once. */
  async shouldSendEachIntrospectionStatementOnce() {
    const querier = await this.pool.getQuerier();
    const all = vi.spyOn(querier, 'all');
    const pool = createMockQuerierPool(this.pool.dialect, async () => querier);

    await new SqliteSchemaIntrospector(pool).getTableSchema(INTROSPECT_TABLES.A);

    const sent = sentStatements(querier.dialect, all).map((statement) => JSON.stringify(statement));
    expect(sent.length).toBe(new Set(sent).size);
  }

  /**
   * A boolean is stored as 0/1, so `TRUE`/`FALSE` read back as those numbers. The clock uql declares reads
   * back as the clock; SQLite's own `CURRENT_TIMESTAMP`, whole seconds in other text, is other SQL.
   */
  async shouldReadEveryDefaultSpelling() {
    const schema = await this.probe('probe_defaults', (querier, table) =>
      querier.run(
        raw.text(/*sql*/ `
        CREATE TABLE ${table} (
          blank TEXT DEFAULT NULL, today TEXT DEFAULT CURRENT_DATE, word TEXT DEFAULT 'x',
          quoted TEXT DEFAULT 'it''s', negative INTEGER DEFAULT -3, fraction REAL DEFAULT 1.5,
          truthy INTEGER DEFAULT TRUE, falsy INTEGER DEFAULT false, computed TEXT DEFAULT (lower('Y')), bare TEXT,
          clock TEXT DEFAULT CURRENT_TIMESTAMP,
          dated TEXT DEFAULT (strftime('%Y-%m-%d 00:00:00.000', 'now')), spelled TEXT DEFAULT 'CURRENT_TIMESTAMP'
        )
      `),
      ),
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
      querier.run(raw.text(`CREATE TABLE ${table} (untyped, code VARCHAR(12))`)),
    );

    expect(schema.columns.map(({ name, type, length }) => ({ name, type, length }))).toEqual([
      { name: 'untyped', type: '', length: undefined },
      { name: 'code', type: 'VARCHAR', length: 12 },
    ]);
  }

  /** The key's own index is not reported, a composite `UNIQUE` is, and only a sole column is `isUnique`. */
  async shouldReportTheIndexesATableDeclares() {
    const schema = await this.probe('probe_indexes', async (querier, table) => {
      await querier.run(
        raw.text(`CREATE TABLE ${table} (code TEXT PRIMARY KEY, v TEXT, w TEXT UNIQUE, UNIQUE (v, w))`),
      );
      await querier.run(raw.text(`CREATE INDEX probe_indexes_v_idx ON ${table} (v)`));
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

    expect(schema.foreignKeys?.map((key) => key.name)).toEqual([undefined]);
    expect(ast.getTable(INTROSPECT_TABLES.B)?.outgoingRelations.map((relation) => relation.name)).toEqual([
      `${INTROSPECT_TABLES.B}__a_id_fk`,
    ]);
  }

  /** A trigger written by hand is left alone: only the ones under uql's own prefix are reported, to reconcile. */
  async shouldReportOnlyTheTriggersUqlInstalled() {
    const mine = 'CREATE TRIGGER _uql_probe_triggers__mine AFTER UPDATE ON "probe_triggers" BEGIN SELECT 1; END';
    const schema = await this.probe('probe_triggers', async (querier, table) => {
      await querier.run(raw.text(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, n INTEGER)`));
      await querier.run(raw.text(`CREATE TRIGGER hand_made AFTER UPDATE ON ${table} BEGIN SELECT 1; END`));
      await querier.run(raw.text(mine));
    });

    expect(schema.triggers).toEqual([{ name: '_uql_probe_triggers__mine', statements: [mine] }]);
  }

  async shouldReadATableWhoseNameNeedsEscaping() {
    const table = 'probe`quoted';
    const schema = await this.probe(table, (querier, escapedTable) =>
      querier.run(raw.text(`CREATE TABLE ${escapedTable} (id INTEGER PRIMARY KEY)`)),
    );

    expect(schema).toMatchObject({ name: table, primaryKey: { columns: ['id'] } });
  }
}

createSpec(new SqliteIntrospectorIt(new SqliteQuerierPool(':memory:')));
