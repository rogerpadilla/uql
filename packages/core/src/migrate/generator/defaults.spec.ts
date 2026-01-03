import { describe, expect, it } from 'bun:test';
import { MysqlSchemaGenerator } from './mysqlSchemaGenerator.js';
import { PostgresSchemaGenerator } from './postgresSchemaGenerator.js';
import { SqliteSchemaGenerator } from './sqliteSchemaGenerator.js';

describe('Schema Generator Defaults', () => {
  it('Postgres should default string to TEXT and respect explicit length', () => {
    const generator = new PostgresSchemaGenerator();
    expect(generator.getSqlType({}, String)).toBe('TEXT');
    expect(generator.getSqlType({ length: 100 }, String)).toBe('VARCHAR(100)');
    expect(generator.getSqlType({ columnType: 'varchar' }, String)).toBe('TEXT');
    expect(generator.getSqlType({ columnType: 'varchar', length: 50 }, String)).toBe('VARCHAR(50)');
  });

  it('SQLite should default string to TEXT', () => {
    const generator = new SqliteSchemaGenerator();
    expect(generator.getSqlType({}, String)).toBe('TEXT');
    expect(generator.getSqlType({ length: 100 }, String)).toBe('TEXT');
    expect(generator.getSqlType({ columnType: 'varchar' }, String)).toBe('TEXT');
  });

  it('MySQL should default string to VARCHAR(255)', () => {
    const generator = new MysqlSchemaGenerator();
    expect(generator.getSqlType({}, String)).toBe('VARCHAR(255)');
    expect(generator.getSqlType({ length: 100 }, String)).toBe('VARCHAR(100)');
    expect(generator.getSqlType({ columnType: 'varchar' }, String)).toBe('VARCHAR(255)');
  });
});
