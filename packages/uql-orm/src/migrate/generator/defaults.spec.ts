import { describe, expect, it } from 'vitest';
import { CockroachDialect } from '../../cockroachdb/cockroachDialect.js';
import type { AbstractSqlDialect } from '../../dialect/index.js';
import { MariaDialect } from '../../maria/mariaDialect.js';
import { MySqlDialect } from '../../mysql/mysqlDialect.js';
import { PostgresDialect } from '../../postgres/postgresDialect.js';
import { canonicalToSql } from '../../schema/canonicalType.js';
import type { TypeCategory } from '../../schema/types.js';
import { SqliteDialect } from '../../sqlite/sqliteDialect.js';
import { DIALECT_DEFAULTS, expr, formatDefaultValue } from '../builder/expressions.js';
import { SqlSchemaGenerator } from '../schemaGenerator.js';

describe('Schema Generator Defaults', () => {
  it('Postgres should default string to TEXT and respect explicit length', () => {
    const generator = new SqlSchemaGenerator(new PostgresDialect());
    expect(generator.getSqlType({}, String)).toBe('TEXT');
    expect(generator.getSqlType({ length: 100 }, String)).toBe('VARCHAR(100)');
    expect(generator.getSqlType({ columnType: 'varchar' }, String)).toBe('TEXT');
    expect(generator.getSqlType({ columnType: 'varchar', length: 50 }, String)).toBe('VARCHAR(50)');
  });

  it('SQLite should default string to TEXT', () => {
    const generator = new SqlSchemaGenerator(new SqliteDialect());
    expect(generator.getSqlType({}, String)).toBe('TEXT');
    expect(generator.getSqlType({ length: 100 }, String)).toBe('TEXT');
    expect(generator.getSqlType({ columnType: 'varchar' }, String)).toBe('TEXT');
  });

  it('MySQL should default string to VARCHAR(255)', () => {
    const generator = new SqlSchemaGenerator(new MySqlDialect());
    expect(generator.getSqlType({}, String)).toBe('VARCHAR(255)');
    expect(generator.getSqlType({ length: 100 }, String)).toBe('VARCHAR(100)');
    expect(generator.getSqlType({ columnType: 'varchar' }, String)).toBe('VARCHAR(255)');
  });
});

describe('Default value expressions', () => {
  const fmt = (dialect: AbstractSqlDialect, value: unknown, columnType?: string): string =>
    formatDefaultValue(value, dialect, columnType);
  const postgres = new PostgresDialect();
  const mysql = new MySqlDialect();
  const mariadb = new MariaDialect();
  const sqlite = new SqliteDialect();
  const cockroach = new CockroachDialect();

  it('should render the timestamp kinds identically everywhere', () => {
    expect(fmt(postgres, expr.now())).toBe('CURRENT_TIMESTAMP');
    expect(fmt(mysql, expr.now())).toBe('CURRENT_TIMESTAMP');
    expect(fmt(sqlite, expr.currentDate())).toBe('CURRENT_DATE');
    expect(fmt(sqlite, expr.currentTime())).toBe('CURRENT_TIME');
  });

  /** The reason the kinds are symbolic: one migration, three spellings. */
  it('should render uuid per engine', () => {
    expect(fmt(postgres, expr.uuid())).toBe('gen_random_uuid()');
    expect(fmt(mysql, expr.uuid())).toBe('UUID()');
    expect(fmt(mariadb, expr.uuid())).toBe('UUID()');
  });

  it('should throw rather than emit a uuid default SQLite has no function for', () => {
    expect(() => fmt(sqlite, expr.uuid())).toThrow(/sqlite has no 'uuid' default/);
  });

  /** Version floor, not dialect: `uuidv7()` is Postgres 18+, `UUID_v7()` MariaDB 11.7+. */
  it('should render uuidv7 only where the engine has one', () => {
    expect(fmt(postgres, expr.uuidv7())).toBe('uuidv7()');
    expect(fmt(mariadb, expr.uuidv7())).toBe('UUID_v7()');
    expect(() => fmt(mysql, expr.uuidv7())).toThrow(/mysql has no 'uuidv7' default/);
    expect(() => fmt(sqlite, expr.uuidv7())).toThrow(/sqlite has no 'uuidv7' default/);
    expect(() => fmt(cockroach, expr.uuidv7())).toThrow(/cockroachdb has no 'uuidv7' default/);
  });

  /** MySQL's rule is about the column, not the value: every default on a large type needs wrapping. */
  it('should wrap defaults on the column types MySQL demands an expression for', () => {
    expect(fmt(mysql, {}, 'JSON')).toBe("('{}')");
    expect(fmt(mysql, { a: 1 }, 'JSON')).toBe('(\'{\\"a\\":1}\')');
    expect(fmt(mysql, 'none', 'TEXT')).toBe("('none')");
    expect(fmt(mysql, 'none', 'LONGTEXT')).toBe("('none')");
    expect(fmt(mysql, expr.uuid(), 'TEXT')).toBe('(UUID())');
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
    expect(fmt(mysql, expr.now(), 'TIMESTAMP')).toBe('CURRENT_TIMESTAMP');
    expect(fmt(postgres, {}, 'JSONB')).toBe("'{}'");
    expect(fmt(sqlite, 'none', 'TEXT')).toBe("'none'");
  });

  it('should render onUpdateNow on MySQL and throw elsewhere', () => {
    expect(fmt(mysql, expr.onUpdateNow())).toBe('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    expect(() => fmt(postgres, expr.onUpdateNow())).toThrow(/no 'onUpdateNow' default/);
  });

  it('should pass raw SQL through untouched', () => {
    expect(fmt(postgres, expr.raw("nextval('s')"))).toBe("nextval('s')");
    expect(fmt(sqlite, expr.raw('unixepoch()'))).toBe('unixepoch()');
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
    expect(fmt(postgres, at)).toBe("'2024-01-15 10:30:00.000'");
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

  /** Drift compares the entity's desired default against the engine's own text for the column. */
  it('should not report drift for a symbolic default the engine echoes back', () => {
    class DriftProbe extends SqlSchemaGenerator {
      defaultsMatch(current: unknown, desired: unknown): boolean {
        return this.isDefaultValueEqual(current, desired);
      }
    }
    const probe = new DriftProbe(postgres);

    expect(probe.defaultsMatch('CURRENT_TIMESTAMP', expr.now())).toBe(true);
    expect(probe.defaultsMatch('gen_random_uuid()', expr.uuid())).toBe(true);
    expect(probe.defaultsMatch("'{}'::jsonb", {})).toBe(true);
    expect(probe.defaultsMatch('CURRENT_DATE', expr.now())).toBe(false);
  });

  /** `expr` holds only what a plain value cannot express; `raw` is exempt, being the escape hatch. */
  it('should build nothing formatDefaultValue already produces from a plain value', () => {
    const plain = [null, true, false, 0, 1, 42, 3.14, '', 'now', 'NULL', {}, [], new Date(0)];

    for (const dialect of [postgres, mysql, mariadb, sqlite, cockroach]) {
      const supported = Object.values(DIALECT_DEFAULTS[dialect.dialectName].expressions).filter((sql) => sql !== null);
      const fromPlain = plain.map((value) => fmt(dialect, value));
      expect(supported.filter((sql) => fromPlain.includes(sql))).toEqual([]);
    }
  });
});
