import { describe, expect, it } from 'bun:test';
import { MysqlSchemaGenerator } from './mysqlSchemaGenerator.js';

describe('MysqlSchemaGenerator Specifics', () => {
  const generator = new MysqlSchemaGenerator();

  it('should map column types correctly', () => {
    expect(generator.getSqlType({ columnType: 'varchar', length: 100 }, String)).toBe('VARCHAR(100)');
    expect(generator.getSqlType({ columnType: 'text' }, String)).toBe('TEXT');
    expect(generator.getSqlType({ columnType: 'int' }, Number)).toBe('INT');
    expect(generator.getSqlType({ columnType: 'bigint' }, Number)).toBe('BIGINT');
    expect(generator.getSqlType({ type: Boolean }, Boolean)).toBe('TINYINT(1)');
    expect(generator.getSqlType({ columnType: 'decimal', precision: 10, scale: 2 }, Number)).toBe('DECIMAL(10, 2)');
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
    const statements = generator.generateAlterColumnStatements('users', col, 'INT NOT NULL DEFAULT 18');

    expect(statements).toEqual(['ALTER TABLE `users` MODIFY COLUMN INT NOT NULL DEFAULT 18;']);
  });

  it('should get table options', () => {
    expect(generator.getTableOptions()).toContain('ENGINE=InnoDB');
  });
});
