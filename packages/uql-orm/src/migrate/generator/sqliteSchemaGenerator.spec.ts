import { describe, expect, it } from 'vitest';
import { SqlSchemaGenerator } from '../schemaGenerator.js';

describe('SqliteSchemaGenerator Specifics', () => {
  const generator = new SqlSchemaGenerator('sqlite');

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

  it('should format default values correctly', () => {
    expect(generator.formatDefaultValue('test')).toBe("'test'");
    expect(generator.formatDefaultValue(123)).toBe('123');
    expect(generator.formatDefaultValue(true)).toBe('1');
    expect(generator.formatDefaultValue(false)).toBe('0');
  });

  it('should return boolean type', () => {
    expect(generator.getBooleanType()).toBe('INTEGER');
  });

  it('should return empty string for column comment', () => {
    expect(generator.generateColumnComment('name', 'comment')).toBe('');
  });

  it('should get table options', () => {
    expect(generator.getTableOptions({} as any)).toBe('');
  });
});
