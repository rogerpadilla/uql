import { describe, expect, it } from 'vitest';
import { MySqlDialect, PostgresDialect, SqliteDialect } from '../../dialect/index.js';
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
