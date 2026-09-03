import { describe, expect, it } from 'vitest';
import { SqliteDialect } from '../../sqlite/sqliteDialect.js';
import { SqlSchemaGenerator } from '../schemaGenerator.js';

describe('SqliteSchemaGenerator Specifics', () => {
  const generator = new SqlSchemaGenerator(new SqliteDialect());

  it('should map column types correctly', () => {
    expect(generator.getSqlType({ columnType: 'varchar', length: 100 }, String)).toBe('TEXT');
    expect(generator.getSqlType({ columnType: 'int' }, Number)).toBe('INTEGER');
    expect(generator.getSqlType({ type: Boolean }, Boolean)).toBe('INTEGER');
  });

  it('should throw error on generateAlterColumnStatements (SQLite limitation)', () => {
    const col = {
      name: 'age',
      type: 'INTEGER',
      nullable: false,
      isPrimaryKey: false,
      isAutoIncrement: false,
      isUnique: false,
    };
    // SQLite doesn't support ALTER COLUMN - requires table recreation
    expect(() => generator.generateAlterColumnStatements('users', col, '`age` INTEGER')).toThrow('Cannot alter column');
  });

  it('should return empty string for column comment', () => {
    expect(generator.generateColumnComment('name', 'comment')).toBe('');
  });
});
