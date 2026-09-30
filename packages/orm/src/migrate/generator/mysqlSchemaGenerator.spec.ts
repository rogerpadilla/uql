import { describe, expect, it } from 'vitest';
import { Entity, Id } from '../../entity/index.js';
import { MySqlDialect } from '../../mysql/mysqlDialect.js';
import { sqlTypeOf } from '../../test/index.js';
import { tableDdlFor } from '../ddl/index.js';
import { SqlSchemaGenerator } from '../schemaGenerator.js';

describe('MysqlSchemaGenerator Specifics', () => {
  const dialect = new MySqlDialect();
  const generator = new SqlSchemaGenerator(dialect);
  const tableDdl = tableDdlFor(new MySqlDialect());

  it('should map column types correctly', () => {
    expect(sqlTypeOf(dialect, { type: String, length: 100 })).toBe('VARCHAR(100)');
    expect(sqlTypeOf(dialect, { type: String })).toBe('VARCHAR(255)');
    expect(sqlTypeOf(dialect, { columnType: 'varchar', length: 100 })).toBe('VARCHAR(100)');
    expect(sqlTypeOf(dialect, { columnType: 'varchar' })).toBe('VARCHAR(255)');
    expect(sqlTypeOf(dialect, { columnType: 'text' })).toBe('TEXT');
    expect(sqlTypeOf(dialect, { columnType: 'int' })).toBe('INT');
    expect(sqlTypeOf(dialect, { columnType: 'bigint' })).toBe('BIGINT');
    expect(sqlTypeOf(dialect, { type: Boolean })).toBe('TINYINT(1)');
    expect(sqlTypeOf(dialect, { columnType: 'decimal', precision: 10, scale: 2 })).toBe('DECIMAL(10, 2)');
  });

  it('should spell a generated key from its own column type', () => {
    @Entity()
    class IntKeyed {
      @Id({ type: Number, columnType: 'int' }) id?: number;
    }

    expect(generator.generateCreateSchema([IntKeyed]).join('\n')).toContain('`id` INT AUTO_INCREMENT');
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
    const statements = tableDdl.alterColumn('users', col, '`age` INT NOT NULL DEFAULT 18');

    expect(statements).toEqual(['ALTER TABLE `users` MODIFY COLUMN `age` INT NOT NULL DEFAULT 18;']);
  });

  const rank = {
    name: 'rank',
    type: 'BIGINT',
    nullable: false,
    isPrimaryKey: false,
    isAutoIncrement: false,
    isUnique: false,
  };

  /** Added whole, MySQL would fill a zero into every row already there; required after, it fails on them. */
  it('should add a required column with no default nullable, then require it', () => {
    expect(generator.generateAlterTable({ tableName: 'users', type: 'alter', columns: [{ to: rank }] })).toEqual([
      'ALTER TABLE `users` ADD COLUMN `rank` BIGINT;',
      'ALTER TABLE `users` MODIFY COLUMN `rank` BIGINT NOT NULL;',
    ]);
  });

  it('should fill the nulls of a column it requires with the default it declares', () => {
    const diff = {
      tableName: 'users',
      type: 'alter',
      columns: [{ from: { ...rank, nullable: true }, to: { ...rank, defaultValue: 5 } }],
    } as const;

    expect(generator.generateAlterTable(diff)).toEqual([
      'UPDATE `users` SET `rank` = 5 WHERE `rank` IS NULL;',
      'ALTER TABLE `users` MODIFY COLUMN `rank` BIGINT NOT NULL DEFAULT 5;',
    ]);
  });

  it('should generate column comment', () => {
    expect(generator.generateColumnComment("user's name")).toBe(" COMMENT 'user\\'s name'");
  });

  it('should generate DROP INDEX statement', () => {
    expect(generator.generateDropIndex('users', 'test_idx')).toBe('DROP INDEX `test_idx` ON `users`;');
  });
});
