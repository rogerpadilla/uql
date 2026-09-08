import { describe, expect, it } from 'vitest';
import { MySqlDialect } from '../../mysql/mysqlDialect.js';
import { SqlSchemaGenerator } from '../schemaGenerator.js';

describe('MysqlSchemaGenerator Specifics', () => {
  const generator = new SqlSchemaGenerator(new MySqlDialect());

  it('should map column types correctly', () => {
    expect(generator.getSqlType({ type: String, length: 100 })).toBe('VARCHAR(100)');
    expect(generator.getSqlType({ type: String })).toBe('VARCHAR(255)');
    expect(generator.getSqlType({ columnType: 'varchar', length: 100 })).toBe('VARCHAR(100)');
    expect(generator.getSqlType({ columnType: 'varchar' })).toBe('VARCHAR(255)');
    expect(generator.getSqlType({ columnType: 'text' })).toBe('TEXT');
    expect(generator.getSqlType({ columnType: 'int' })).toBe('INT');
    expect(generator.getSqlType({ columnType: 'bigint' })).toBe('BIGINT');
    expect(generator.getSqlType({ type: Boolean })).toBe('TINYINT(1)');
    expect(generator.getSqlType({ columnType: 'decimal', precision: 10, scale: 2 })).toBe('DECIMAL(10, 2)');
    expect(generator.getSqlType({ type: Number, isId: true })).toBe('BIGINT AUTO_INCREMENT');
    expect(generator.getSqlType({ type: Number, isId: true, columnType: 'int' })).toBe('INT AUTO_INCREMENT');
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

  it('should generate column comment', () => {
    expect(generator.generateColumnComment('name', "user's name")).toBe(" COMMENT 'user''s name'");
  });

  it('should generate DROP INDEX statement', () => {
    expect(generator.generateDropIndex('users', 'test_idx')).toBe('DROP INDEX `test_idx` ON `users`;');
  });
});
