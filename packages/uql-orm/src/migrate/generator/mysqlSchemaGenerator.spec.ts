import { describe, expect, it } from 'vitest';
import { SqlSchemaGenerator } from '../schemaGenerator.js';

describe('MysqlSchemaGenerator Specifics', () => {
  const generator = new SqlSchemaGenerator('mysql');

  it('should map column types correctly', () => {
    expect(generator.getSqlType({ length: 100 }, String)).toBe('VARCHAR(100)');
    expect(generator.getSqlType({}, String)).toBe('VARCHAR(255)');
    expect(generator.getSqlType({ columnType: 'varchar', length: 100 }, String)).toBe('VARCHAR(100)');
    expect(generator.getSqlType({ columnType: 'varchar' }, String)).toBe('VARCHAR(255)');
    expect(generator.getSqlType({ columnType: 'text' }, String)).toBe('TEXT');
    expect(generator.getSqlType({ columnType: 'int' }, Number)).toBe('INT');
    expect(generator.getSqlType({ columnType: 'bigint' }, Number)).toBe('BIGINT');
    expect(generator.getSqlType({ type: Boolean }, Boolean)).toBe('TINYINT(1)');
    expect(generator.getSqlType({ columnType: 'decimal', precision: 10, scale: 2 }, Number)).toBe('DECIMAL(10, 2)');
    expect(generator.getSqlType({ columnType: 'serial' }, {})).toBe('BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY');
    expect(generator.getSqlType({ columnType: 'bigserial' }, {})).toBe('BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY');
  });

  it('should generate ALTER COLUMN statements', () => {
    const col = {
      name: 'age',
      type: 'INT',
      nullable: false,
      defaultValue: 18,
      isPrimaryKey: false,
      isAutoIncrement: false,
      isUnique: false,
    };
    // newDefinition should include the column name (as generateColumnDefinitionFromSchema does)
    const statements = generator.generateAlterColumnStatements('users', col, '`age` INT NOT NULL DEFAULT 18');

    expect(statements).toEqual(['ALTER TABLE `users` MODIFY COLUMN `age` INT NOT NULL DEFAULT 18;']);
  });

  it('should get table options', () => {
    expect(generator.getTableOptions({} as any)).toContain('ENGINE=InnoDB');
  });

  it('should get boolean type', () => {
    expect(generator.getBooleanType()).toBe('TINYINT(1)');
  });

  it('should generate column comment', () => {
    expect(generator.generateColumnComment('name', "user's name")).toBe(" COMMENT 'user''s name'");
  });

  it('should generate DROP INDEX statement', () => {
    expect(generator.generateDropIndex('users', 'idx_test')).toBe('DROP INDEX `idx_test` ON `users`;');
  });
});
