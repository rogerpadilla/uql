import { describe, expect, it } from '@jest/globals';
import { PostgresSchemaGenerator } from './postgresSchemaGenerator.js';

describe('PostgresSchemaGenerator Specifics', () => {
  const generator = new PostgresSchemaGenerator();

  it('should format default values correctly', () => {
    expect(generator.formatDefaultValue('test')).toBe("'test'");
    expect(generator.formatDefaultValue(123)).toBe('123');
    expect(generator.formatDefaultValue(true)).toBe('TRUE');
    expect(generator.formatDefaultValue(false)).toBe('FALSE');
    expect(generator.formatDefaultValue(null)).toBe('NULL');
  });

  it('should map column types correctly', () => {
    expect(generator.getSqlType({ columnType: 'varchar', length: 100 }, String)).toBe('VARCHAR(100)');
    expect(generator.getSqlType({ columnType: 'text' }, String)).toBe('TEXT');
    expect(generator.getSqlType({ columnType: 'int' }, Number)).toBe('INTEGER');
    expect(generator.getSqlType({ columnType: 'bigint' }, Number)).toBe('BIGINT');
    expect(generator.getSqlType({ type: Boolean }, Boolean)).toBe('BOOLEAN');
    expect(generator.getSqlType({ columnType: 'decimal', precision: 10, scale: 2 }, Number)).toBe('NUMERIC(10, 2)');
  });

  it('should generate DROP INDEX statement', () => {
    expect(generator.generateDropIndex('users', 'idx_test')).toBe('DROP INDEX IF EXISTS "idx_test";');
  });

  it('should generate ALTER COLUMN statements', () => {
    const col = {
      name: 'age',
      type: 'INTEGER',
      nullable: false,
      defaultValue: 18,
      isPrimaryKey: false,
      isAutoIncrement: false,
      isUnique: false,
    };
    const statements = generator.generateAlterColumnStatements('users', col, 'INTEGER');

    expect(statements).toContain('ALTER TABLE "users" ALTER COLUMN "age" TYPE INTEGER;');
    expect(statements).toContain('ALTER TABLE "users" ALTER COLUMN "age" SET NOT NULL;');
    expect(statements).toContain('ALTER TABLE "users" ALTER COLUMN "age" SET DEFAULT 18;');
  });
});
