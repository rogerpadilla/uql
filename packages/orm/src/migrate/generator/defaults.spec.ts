import { describe, expect, it } from 'vitest';
import { CockroachDialect } from '../../cockroachdb/cockroachDialect.js';
import type { AbstractSqlDialect } from '../../dialect/index.js';
import { MariaDialect } from '../../mariadb/mariaDialect.js';
import { MsSqlDialect } from '../../mssql/mssqlDialect.js';
import { MySqlDialect } from '../../mysql/mysqlDialect.js';
import { PostgresDialect } from '../../postgres/postgresDialect.js';
import { canonicalToSql } from '../../schema/canonicalType.js';
import { SqlExpression } from '../../schema/sqlExpression.js';
import type { TypeCategory } from '../../schema/types.js';
import { SqliteDialect } from '../../sqlite/sqliteDialect.js';
import { currentDate, currentTime, currentTimestamp, uuid, uuidv7, raw } from '../../util/raw.js';
import { DIALECT_DEFAULTS, formatDefaultValue } from '../ddl/defaultSql.js';
import { SqlSchemaGenerator } from '../schemaGenerator.js';

describe('Default value expressions', () => {
  const fmt = (dialect: AbstractSqlDialect, value: unknown, columnType?: string): string =>
    formatDefaultValue(value, dialect, columnType);
  const postgres = new PostgresDialect();
  const mysql = new MySqlDialect();
  const mariadb = new MariaDialect();
  const sqlite = new SqliteDialect();
  const cockroach = new CockroachDialect();
  const mssql = new MsSqlDialect();

  /** The clock each engine's statements read, which writes a timestamp uql reads back as it stored it. */
  it('should render the timestamp kinds as the text a bound Date is written as', () => {
    expect(fmt(postgres, currentTimestamp)).toBe('CURRENT_TIMESTAMP');
    expect(fmt(mysql, currentTimestamp)).toBe('CURRENT_TIMESTAMP');
    expect(fmt(mssql, currentTimestamp)).toBe('SYSUTCDATETIME()');
    expect(fmt(sqlite, currentTimestamp)).toBe("(strftime('%Y-%m-%d %H:%M:%f', 'now'))");
    expect(fmt(sqlite, currentDate)).toBe("(strftime('%Y-%m-%d 00:00:00.000', 'now'))");
    expect(fmt(sqlite, currentTime)).toBe('CURRENT_TIME');
  });

  /** The reason the kinds are symbolic: one migration, three spellings. */
  it('should render uuid per engine', () => {
    expect(fmt(postgres, uuid)).toBe('gen_random_uuid()');
    expect(fmt(mysql, uuid)).toBe('UUID()');
    expect(fmt(mariadb, uuid)).toBe('UUID()');
  });

  it('should throw rather than emit a uuid default SQLite has no function for', () => {
    expect(() => fmt(sqlite, uuid)).toThrow(/sqlite has no uuid/);
  });

  /** Version floor, not dialect: `uuidv7()` is Postgres 18+, `UUID_v7()` MariaDB 11.7+. */
  it('should render uuidv7 only where the engine has one', () => {
    expect(fmt(postgres, uuidv7)).toBe('uuidv7()');
    expect(fmt(mariadb, uuidv7)).toBe('UUID_v7()');
    expect(() => fmt(mysql, uuidv7)).toThrow(/mysql has no uuidv7/);
    expect(() => fmt(sqlite, uuidv7)).toThrow(/sqlite has no uuidv7/);
    expect(() => fmt(cockroach, uuidv7)).toThrow(/cockroachdb has no uuidv7/);
  });

  /** MySQL's rule is about the column, not the value: every default on a large type needs wrapping. */
  it('should wrap defaults on the column types MySQL demands an expression for', () => {
    expect(fmt(mysql, {}, 'JSON')).toBe("('{}')");
    expect(fmt(mysql, { a: 1 }, 'JSON')).toBe('(\'{\\"a\\":1}\')');
    expect(fmt(mysql, 'none', 'TEXT')).toBe("('none')");
    expect(fmt(mysql, 'none', 'LONGTEXT')).toBe("('none')");
    expect(fmt(mysql, uuid, 'TEXT')).toBe('(UUID())');
    expect(fmt(mariadb, 'none', 'MEDIUMBLOB')).toBe("('none')");
  });

  /**
   * `wrapTypes` matches the spellings `canonicalToSql` emits, so the two have to agree. Renaming a
   * type there would otherwise stop the wrapping silently and put invalid DDL back on MySQL.
   */
  it('should wrap every large type canonicalToSql actually emits', () => {
    const emitted = (category: TypeCategory) => canonicalToSql({ category }, mysql);
    const { wrapTypes } = DIALECT_DEFAULTS.mysql;

    expect([emitted('json'), emitted('blob')]).toEqual(['JSON', 'BLOB']);
    expect(wrapTypes?.test(emitted('json'))).toBe(true);
    expect(wrapTypes?.test(emitted('blob'))).toBe(true);
    expect(wrapTypes?.test(emitted('string'))).toBe(false);
    expect(wrapTypes?.test(emitted('integer'))).toBe(false);
  });

  it('should leave defaults on ordinary column types bare', () => {
    expect(fmt(mysql, 'none', 'VARCHAR(255)')).toBe("'none'");
    expect(fmt(mysql, 0, 'INTEGER')).toBe('0');
    expect(fmt(mysql, currentTimestamp, 'TIMESTAMP')).toBe('CURRENT_TIMESTAMP');
    expect(fmt(postgres, {}, 'JSONB')).toBe("'{}'");
    expect(fmt(sqlite, 'none', 'TEXT')).toBe("'none'");
  });

  /** MySQL refuses a `CURRENT_TIMESTAMP` default whose precision differs from its column's. */
  it('should give a now default the precision of its MySQL column', () => {
    expect(fmt(mysql, currentTimestamp, 'DATETIME(3)')).toBe('CURRENT_TIMESTAMP(3)');
    expect(fmt(mysql, new SqlExpression('raw', 'CURRENT_TIMESTAMP'), 'DATETIME(3)')).toBe('CURRENT_TIMESTAMP');
    expect(fmt(postgres, currentTimestamp, 'TIMESTAMP(3)')).toBe('CURRENT_TIMESTAMP');
  });

  /** `raw` is the same SQL an entity declares, parenthesized as SQLite and MySQL require of an expression. */
  it('should compile a raw default and parenthesize it', () => {
    expect(fmt(sqlite, raw`unixepoch()`)).toBe('(unixepoch())');
    expect(fmt(postgres, raw`nextval('s')`)).toBe("(nextval('s'))");
  });

  it('should pass raw SQL through untouched', () => {
    expect(fmt(postgres, new SqlExpression('raw', "nextval('s')"))).toBe("nextval('s')");
    expect(fmt(sqlite, new SqlExpression('raw', 'unixepoch()'))).toBe('unixepoch()');
  });

  it('should format plain values as literals', () => {
    expect(fmt(postgres, 'hello')).toBe("'hello'");
    expect(fmt(postgres, "it's")).toBe("'it''s'");
    expect(fmt(postgres, 42)).toBe('42');
    expect(fmt(postgres, 3.14)).toBe('3.14');
    expect(fmt(postgres, null)).toBe('NULL');
    expect(fmt(postgres, undefined)).toBe('NULL');
    expect(fmt(postgres, { key: 'value' })).toBe('\'{"key":"value"}\'');
    expect(fmt(postgres, [1, 2, 3])).toBe("'[1,2,3]'");
  });

  /** MySQL rejects `toISOString`'s `T` and `Z` outright ("Invalid default value"). UTC, not local. */
  it('should format a Date default as SQL every engine accepts', () => {
    const at = new Date('2024-01-15T10:30:00.000Z');
    expect(fmt(postgres, at)).toBe("'2024-01-15 10:30:00.000+00'");
    expect(fmt(mysql, at)).toBe("'2024-01-15 10:30:00.000'");
    expect(fmt(sqlite, at)).toBe("'2024-01-15 10:30:00.000'");
  });

  /** MySQL reads `\b` in a literal as a backspace; Postgres and SQLite take it as two characters. */
  it('should escape a default the way the engine reads it', () => {
    expect(fmt(mysql, 'a\\b')).toBe("'a\\\\b'");
    expect(fmt(postgres, 'a\\b')).toBe("'a\\b'");
    expect(fmt(mysql, { path: 'a\\b' })).toBe('\'{\\"path\\":\\"a\\\\\\\\b\\"}\'');
  });

  it('should format booleans as the engine stores them', () => {
    expect(fmt(postgres, true)).toBe('TRUE');
    expect(fmt(postgres, false)).toBe('FALSE');
    expect(fmt(mysql, true)).toBe('1');
    expect(fmt(sqlite, false)).toBe('0');
  });

  /** Drift compares the entity's desired default against what introspection read back, as the engine reprints it. */
  it('should not report drift for SQL the engine reprints as it was declared', () => {
    const generator = new SqlSchemaGenerator(postgres);

    expect(generator.defaultsEqual(currentTimestamp, new SqlExpression('raw', '(CURRENT_TIMESTAMP)'))).toBe(true);
    expect(generator.defaultsEqual(uuid, new SqlExpression('raw', '(gen_random_uuid())'))).toBe(true);
    expect(generator.defaultsEqual({}, '{}')).toBe(true);
    expect(generator.defaultsEqual(currentTimestamp, new SqlExpression('raw', '(CURRENT_DATE)'))).toBe(false);
  });

  /** The reprints engines differ in, each taken out on its own engine: see `columnDefault.test.ts`. */
  it('should read SQL alike past case, spacing, wrapping parentheses and an empty argument list', () => {
    const generator = new SqlSchemaGenerator(cockroach);

    expect(generator.defaultsEqual(currentTimestamp, new SqlExpression('raw', '(current_timestamp())'))).toBe(true);
    expect(
      generator.defaultsEqual(
        new SqlExpression('raw', "coalesce(NULL, 'a')"),
        new SqlExpression('raw', "((coalesce(NULL,'a')))"),
      ),
    ).toBe(true);
    expect(
      generator.defaultsEqual(
        new SqlExpression('raw', "coalesce(NULL, 'a')"),
        new SqlExpression('raw', "(coalesce(NULL, 'b'))"),
      ),
    ).toBe(false);
  });

  /** A literal that spells the clock is text, so it neither is the clock nor passes for it. */
  it('should never read a literal as the SQL it spells', () => {
    const generator = new SqlSchemaGenerator(postgres);

    expect(generator.defaultsEqual('CURRENT_TIMESTAMP', new SqlExpression('raw', '(CURRENT_TIMESTAMP)'))).toBe(false);
    expect(generator.defaultsEqual(currentTimestamp, 'CURRENT_TIMESTAMP')).toBe(false);
  });

  /** A SQL value holds only what a plain value cannot express. */
  it('should build nothing formatDefaultValue already produces from a plain value', () => {
    const plain = [null, true, false, 0, 1, 42, 3.14, '', 'now', 'NULL', {}, [], new Date(0)];

    for (const dialect of [postgres, mysql, mariadb, sqlite, cockroach]) {
      const supported = Object.values(dialect.sqlValues).filter((sql) => sql !== undefined);
      const fromPlain = plain.map((value) => fmt(dialect, value));
      expect(supported.filter((sql) => fromPlain.includes(sql))).toEqual([]);
    }
  });
});
