import { describe, expect, it } from 'vitest';
import { PostgresDialect } from '../../postgres/postgresDialect.js';
import { SqlExpression, schemaDefault } from '../../schema/sqlExpression.js';
import { SqliteDialect } from '../../sqlite/sqliteDialect.js';
import { type QueryRaw, SQL_VALUE_NAMES } from '../../type/index.js';
import { currentTimestamp, uuid, raw, SQL_VALUES } from '../../util/raw.js';
import { knownDefault, sameDefault } from './defaultSql.js';

describe('sameDefault', () => {
  it('should read a boolean default as the integer an engine without booleans stores', () => {
    const sqlite = new SqliteDialect();
    expect(sameDefault(false, 0, sqlite)).toBe(true);
    expect(sameDefault(true, '1', sqlite)).toBe(true);
    expect(sameDefault(true, 0, sqlite)).toBe(false);
  });

  /** A `jsonb` column reprints its document; text that holds no JSON document still compares letter for letter. */
  it('should compare a JSON document as JSON, and other text as it is written', () => {
    const postgres = new PostgresDialect();
    expect(sameDefault({ b: 1, a: [1, 2] }, '{"a": [1, 2], "b": 1}', postgres)).toBe(true);
    expect(sameDefault(['x'], '["y"]', postgres)).toBe(false);
    expect(sameDefault('42', '42.0', postgres)).toBe(false);
    expect(sameDefault('CURRENT_TIMESTAMP', 'current_timestamp', postgres)).toBe(false);
  });

  it('should keep a boolean default a boolean where the engine has them', () => {
    const postgres = new PostgresDialect();
    expect(sameDefault(false, false, postgres)).toBe(true);
    expect(sameDefault(false, 0, postgres)).toBe(false);
  });
});

describe('SQL values', () => {
  const postgres = new PostgresDialect();
  const sqlite = new SqliteDialect();

  it('should render in each engine own SQL, in a query as in DDL', () => {
    expect(postgres.compileDdl(uuid)).toBe('gen_random_uuid()');
    expect(sqlite.compileDdl(currentTimestamp)).toBe("(strftime('%Y-%m-%d %H:%M:%f', 'now'))");
  });

  it('should refuse a value the engine has no function for, naming it', () => {
    expect(() => sqlite.compileDdl(uuid)).toThrow('sqlite has no uuid; write it as raw SQL this engine accepts');
  });

  it('should read each one as its kind in the schema, under its own name', () => {
    expect(SQL_VALUE_NAMES.map((name) => schemaDefault(SQL_VALUES[name], (sql) => postgres.compileDdl(sql)))).toEqual(
      SQL_VALUE_NAMES.map((name) => new SqlExpression(name)),
    );
  });

  it('should compile other raw SQL and keep a literal as it is', () => {
    const compile = (sql: QueryRaw) => postgres.compileDdl(sql);
    expect(schemaDefault(raw`now()`, compile)).toEqual(SqlExpression.parenthesized('now()'));
    expect(schemaDefault('CURRENT_TIMESTAMP', compile)).toBe('CURRENT_TIMESTAMP');
  });

  /** What lets drift compare a declared value with the catalogue, and `generate:from-db` name it. */
  it('should read SQL a catalogue reports back as the value that spells it', () => {
    expect(knownDefault(SqlExpression.parenthesized('gen_random_uuid()'), postgres)).toEqual(new SqlExpression('uuid'));
    expect(knownDefault(SqlExpression.parenthesized('CURRENT_TIMESTAMP'), postgres)).toEqual(
      new SqlExpression('currentTimestamp'),
    );
    const other = SqlExpression.parenthesized("nextval('s')");
    expect(knownDefault(other, postgres)).toBe(other);
  });
});
