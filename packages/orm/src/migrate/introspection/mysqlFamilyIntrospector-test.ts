import { expect } from 'vitest';
import type { SchemaIntrospector, SqlQuerier } from '../../type/index.js';
import { AbstractIntrospectorIt, INTROSPECT_TABLES } from './abstractIntrospector-test.js';

/**
 * Shared expectations for MySQL-wire-compatible introspectors (MySQL, MariaDB): both go through
 * {@link MysqlSchemaIntrospector} (which `MariadbSchemaIntrospector` extends) and need FK
 * checks disabled around DDL.
 */
export abstract class MySqlFamilyIntrospectorIt extends AbstractIntrospectorIt {
  /** A database the test user may use besides its own, from `docker/init-*.sql`. */
  protected abstract readonly otherDatabase: string;

  protected abstract introspectorOf(database: string): SchemaIntrospector;

  protected override readonly setDefaultAction = false;

  override async beforeDropTables(querier: SqlQuerier): Promise<void> {
    await querier.run('SET FOREIGN_KEY_CHECKS = 0');
  }

  override async afterDropTables(querier: SqlQuerier): Promise<void> {
    await querier.run('SET FOREIGN_KEY_CHECKS = 1');
  }

  async shouldIntrospectAutoIncrementColumn() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const idCol = this.getColumn(schema, 'id');
    expect(idCol.isAutoIncrement).toBe(true);
  }

  async shouldIntrospectDecimalColumn() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const amountCol = this.getColumn(schema, 'amount');
    expect(amountCol.type.toUpperCase()).toContain('DECIMAL');
    expect(amountCol.precision).toBe(10);
    expect(amountCol.scale).toBe(2);
  }

  async shouldIntrospectVarcharLength() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const statusCol = this.getColumn(schema, 'status');
    expect(statusCol.length).toBe(50);
  }

  async shouldIntrospectTinyintAsBoolean() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const isEnabledCol = this.getColumn(schema, 'is_enabled');
    expect(isEnabledCol.type.toUpperCase()).toContain('TINYINT');
    expect(isEnabledCol.defaultValue).toBe(1);
  }

  /**
   * MariaDB has no JSON type: `JSON` there is `LONGTEXT` plus a `json_valid()` check, so the column
   * reads back as `longtext` unless the introspector looks that check up. Both engines have to
   * answer the same thing - what the column was declared as - or every JSON column on MariaDB drifts
   * against the entity that declared it.
   */
  protected override async addDialectSpecificColumnsA(querier: SqlQuerier): Promise<void> {
    await querier.run(`ALTER TABLE ${INTROSPECT_TABLES.A} ADD COLUMN kind JSON NULL, ADD COLUMN notes LONGTEXT NULL`);
  }

  async shouldIntrospectJsonColumn() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    expect(this.getColumn(schema, 'kind').type.toUpperCase()).toBe('JSON');
  }

  /**
   * The column MariaDB stores a JSON one as. It has no `json_valid()` check, which is the whole
   * difference, and reading it as JSON would turn a plain text column into one on every round trip.
   */
  async shouldIntrospectLongtextColumnAsLongtext() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    expect(this.getColumn(schema, 'notes').type.toUpperCase()).toBe('LONGTEXT');
  }

  async shouldIntrospectTimestampDefault() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const createdAtCol = this.getColumn(schema, 'created_at');
    expect(createdAtCol.type.toUpperCase()).toBe('DATETIME');
    expect(createdAtCol.defaultValue).toBe('CURRENT_TIMESTAMP');
  }

  /** Each engine prints these its own way, see `parseDefaultValue`; both read back what was declared. */
  async shouldReadEveryDefaultSpelling() {
    const schema = await this.probe('probe_defaults', (querier, table) =>
      querier.run(/*sql*/ `
        CREATE TABLE ${table} (
          word VARCHAR(9) DEFAULT 'hello', quoted VARCHAR(9) DEFAULT 'it''s', slash VARCHAR(9) DEFAULT 'a\\\\b',
          lined VARCHAR(9) DEFAULT 'a\\nb', fraction DECIMAL(6, 2) DEFAULT -12.5, negative INT DEFAULT -3,
          stamped DATETIME DEFAULT CURRENT_TIMESTAMP, note TEXT DEFAULT ('o''k'), bare INT NOT NULL
        )
      `),
    );

    expect(Object.fromEntries(schema.columns.map((column) => [column.name, column.defaultValue]))).toEqual({
      word: 'hello',
      quoted: "it's",
      slash: 'a\\b',
      lined: 'a\nb',
      fraction: -12.5,
      negative: -3,
      stamped: 'CURRENT_TIMESTAMP',
      note: "o'k",
      bare: undefined,
    });
  }

  async shouldReadAColumnComment() {
    const schema = await this.probe('probe_comment', (querier, table) =>
      querier.run(`CREATE TABLE ${table} (noted INT COMMENT 'probed', plain INT)`),
    );

    expect(schema.columns.map(({ name, comment }) => ({ name, comment }))).toEqual([
      { name: 'noted', comment: 'probed' },
      { name: 'plain', comment: undefined },
    ]);
  }

  /** A table of the same name in the connection's own database is neither read nor in the way. */
  async shouldReadOnlyTheDatabaseItWasGiven() {
    const querier = await this.pool.getQuerier();
    const table = `${this.otherDatabase}.${INTROSPECT_TABLES.A}`;
    try {
      await querier.run(`DROP TABLE IF EXISTS ${table}`);
      await querier.run(
        `CREATE TABLE ${table} (id INT PRIMARY KEY, code INT UNIQUE, note VARCHAR(9), KEY probe_note_idx (note))`,
      );

      const named = await this.introspectorOf(this.otherDatabase).getTableSchema(INTROSPECT_TABLES.A);

      expect(named).toMatchObject({
        primaryKey: ['id'],
        indexes: [{ name: 'code' }, { name: 'probe_note_idx' }],
        foreignKeys: [],
      });
      expect(named?.columns.map(({ name, isUnique }) => ({ name, isUnique }))).toEqual([
        { name: 'id', isUnique: false },
        { name: 'code', isUnique: true },
        { name: 'note', isUnique: false },
      ]);
    } finally {
      await querier.run(`DROP TABLE ${table}`);
      await querier.release();
    }
  }

  /** Escaped as the engine's own literal: the ANSI doubling leaves a backslash to escape the quote. */
  async shouldEscapeTheDatabaseItWasGiven() {
    await expect(this.introspectorOf("uql\\'probe").getTableNames()).resolves.toEqual([]);
  }
}
