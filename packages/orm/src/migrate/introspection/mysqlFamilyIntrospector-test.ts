import { expect } from 'vitest';
import { SqlExpression } from '../../schema/sqlExpression.js';
import type { SqlQuerier } from '../../type/index.js';
import { sql } from '../../util/sql.js';
import { AbstractIntrospectorIt, INTROSPECT_TABLES } from './abstractIntrospector-test.js';
import { introspectorFor } from './registry.js';

/**
 * Shared expectations for MySQL-wire-compatible introspectors (MySQL, MariaDB): both go through
 * {@link MysqlSchemaIntrospector}, which `MariadbSchemaIntrospector` extends.
 */
export abstract class MySqlFamilyIntrospectorIt extends AbstractIntrospectorIt {
  /** A database the test user may use besides its own, from `docker/init-*.sql`. */
  protected abstract readonly otherDatabase: string;

  protected override readonly setDefaultAction = false;

  protected override readonly partialIndex = false;

  /** A boolean is a `TINYINT(1)`. */
  protected override expectedTrueDefault() {
    return 1;
  }

  /**
   * MariaDB has no JSON type: `JSON` there is `LONGTEXT` plus a `json_valid()` check, so the column
   * reads back as `longtext` unless the introspector looks that check up. Both engines have to
   * answer what the column was declared as, or every JSON column on MariaDB drifts against the entity
   * that declared it.
   */
  protected override async addDialectSpecificColumnsA(querier: SqlQuerier): Promise<void> {
    await querier.run(
      sql.text(`ALTER TABLE ${INTROSPECT_TABLES.A} ADD COLUMN kind JSON NULL, ADD COLUMN notes LONGTEXT NULL`),
    );
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

  /**
   * Each engine prints these its own way, see `parseDefaultValue`; both read back what was declared. MySQL
   * prints the text `'CURRENT_TIMESTAMP'` exactly as the clock, and only `DEFAULT_GENERATED` tells them apart.
   */
  async shouldReadEveryDefaultSpelling() {
    const schema = await this.probe('probe_defaults', (querier, table) =>
      querier.run(
        sql.text(/*sql*/ `
        CREATE TABLE ${table} (
          word VARCHAR(9) DEFAULT 'hello', quoted VARCHAR(9) DEFAULT 'it''s', slash VARCHAR(9) DEFAULT 'a\\\\b',
          lined VARCHAR(9) DEFAULT 'a\\nb', fraction DECIMAL(6, 2) DEFAULT -12.5, negative INT DEFAULT -3,
          stamped DATETIME DEFAULT CURRENT_TIMESTAMP, note TEXT DEFAULT ('o''k'), bare INT NOT NULL,
          spelled VARCHAR(20) DEFAULT 'CURRENT_TIMESTAMP'
        )
      `),
      ),
    );

    expect(Object.fromEntries(schema.columns.map((column) => [column.name, column.defaultValue]))).toEqual({
      word: 'hello',
      quoted: "it's",
      slash: 'a\\b',
      lined: 'a\nb',
      fraction: -12.5,
      negative: -3,
      stamped: new SqlExpression('currentTimestamp'),
      note: "o'k",
      bare: undefined,
      spelled: 'CURRENT_TIMESTAMP',
    });
  }

  async shouldReadAColumnComment() {
    const schema = await this.probe('probe_comment', (querier, table) =>
      querier.run(sql.text(`CREATE TABLE ${table} (noted INT COMMENT 'probed', plain INT)`)),
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
      await querier.run(sql.text(`DROP TABLE IF EXISTS ${table}`));
      await querier.run(
        sql.text(
          `CREATE TABLE ${table} (id INT PRIMARY KEY, code INT UNIQUE, note VARCHAR(9), KEY probe_note_idx (note))`,
        ),
      );

      const named = await introspectorFor(this.pool, this.otherDatabase).getTableSchema(INTROSPECT_TABLES.A);

      expect(named).toMatchObject({
        primaryKey: { columns: ['id'] },
        indexes: [{ name: 'code' }, { name: 'probe_note_idx' }],
        foreignKeys: [],
      });
      expect(named?.columns.map(({ name, isUnique }) => ({ name, isUnique }))).toEqual([
        { name: 'id', isUnique: false },
        { name: 'code', isUnique: true },
        { name: 'note', isUnique: false },
      ]);
    } finally {
      await querier.run(sql.text(`DROP TABLE ${table}`));
      await querier.release();
    }
  }

  /** Bound, so a backslash and a quote in its name are only text. */
  async shouldBindTheDatabaseItWasGiven() {
    await expect(introspectorFor(this.pool, "uql\\'probe").getTableNames()).resolves.toEqual([]);
  }
}
