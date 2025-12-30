import { describe, expect, it } from 'bun:test';
import { SqliteSchemaGenerator } from './sqliteSchemaGenerator.js';

describe('SqliteSchemaGenerator Specifics', () => {
  const generator = new SqliteSchemaGenerator();

  it('should map column types correctly', () => {
    expect(generator.getSqlType({ columnType: 'varchar', length: 100 }, String)).toBe('TEXT');
    expect(generator.getSqlType({ columnType: 'int' }, Number)).toBe('INTEGER');
    expect(generator.getSqlType({ type: Boolean }, Boolean)).toBe('INTEGER');
  });

  it('should throw error on generateAlterColumnStatements', () => {
    const col = {
      name: 'age',
      type: 'INTEGER',
      nullable: false,
      isPrimaryKey: false,
      isAutoIncrement: false,
      isUnique: false,
    };
    expect(() => generator.generateAlterColumnStatements('users', col, 'INTEGER')).toThrow(
      'SQLite does not support altering column',
    );
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
    expect(generator.generateColumnComment('users', 'name', 'comment')).toBe('');
  });
});
