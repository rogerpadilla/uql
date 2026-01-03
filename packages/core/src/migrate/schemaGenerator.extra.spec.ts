import { describe, expect, it, vi } from 'vitest';
import { Entity, Field, getMeta, Id } from '../entity/index.js';
import type { ColumnSchema, ColumnType, FieldOptions } from '../type/index.js';
import { AbstractSchemaGenerator } from './schemaGenerator.js';

@Entity({ name: 'test_entity' })
class TestEntity {
  @Id()
  id?: number;
  @Field()
  name?: string;
}

class TestSchemaGenerator extends AbstractSchemaGenerator {
  protected serialPrimaryKeyType = 'SERIAL PRIMARY KEY';
  mapColumnType(columnType: ColumnType, field: FieldOptions): string {
    if (columnType === 'varchar') return `VARCHAR(${field.length || 255})`;
    return columnType.toUpperCase();
  }
  getBooleanType(): string {
    return 'BOOLEAN';
  }
  generateAlterColumnStatements(tableName: string, column: ColumnSchema, newDefinition: string): string[] {
    return [`ALTER TABLE ${tableName} ALTER COLUMN ${newDefinition}`];
  }
  generateColumnComment(tableName: string, columnName: string, comment: string): string {
    return ` COMMENT '${comment}'`;
  }
}

describe('AbstractSchemaGenerator (extra coverage)', () => {
  const generator = new TestSchemaGenerator();

  it('generateCreateTable with ifNotExists', () => {
    const sql = generator.generateCreateTable(TestEntity, { ifNotExists: true });
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS');
  });

  it('generateColumnDefinition with unique and NOT NULL', () => {
    const meta = getMeta(TestEntity);
    const field = { type: String, unique: true, nullable: false };
    const sql = generator.generateColumnDefinition('name', field, meta);
    expect(sql).toContain('NOT NULL UNIQUE');
  });

  it('generateColumnDefinition with comment', () => {
    const meta = getMeta(TestEntity);
    const field = { type: String, comment: 'Test comment' };
    const sql = generator.generateColumnDefinition('name', field, meta);
    expect(sql).toContain("COMMENT 'Test comment'");
  });

  it('generateColumnDefinitionFromSchema with length, precision, scale', () => {
    const col: ColumnSchema = {
      name: 'price',
      type: 'DECIMAL',
      precision: 10,
      scale: 2,
      nullable: false,
      isPrimaryKey: false,
      isAutoIncrement: false,
      isUnique: false,
    };
    const sql = generator.generateColumnDefinitionFromSchema(col);
    expect(sql).toContain('DECIMAL(10, 2) NOT NULL');

    const col2: ColumnSchema = { ...col, scale: undefined };
    expect(generator.generateColumnDefinitionFromSchema(col2)).toContain('DECIMAL(10) NOT NULL');

    const col3: ColumnSchema = { ...col, type: 'VARCHAR', length: 100, precision: undefined };
    expect(generator.generateColumnDefinitionFromSchema(col3)).toContain('VARCHAR(100) NOT NULL');
  });

  it('generateColumnDefinitionFromSchema with unique', () => {
    const col: ColumnSchema = {
      name: 'email',
      type: 'VARCHAR',
      isUnique: true,
      nullable: true,
      isPrimaryKey: false,
      isAutoIncrement: false,
    };
    const sql = generator.generateColumnDefinitionFromSchema(col);
    expect(sql).toContain('UNIQUE');
  });

  it('generateTableConstraints with index', () => {
    const meta = getMeta(TestEntity);
    (meta.fields.name as { index?: boolean | string }).index = true;
    const constraints = generator.generateTableConstraints(meta);
    expect(constraints.some((c) => c.includes('INDEX') && c.includes('idx_test_entity_name'))).toBe(true);

    (meta.fields.name as { index?: boolean | string }).index = 'custom_idx';
    const constraints2 = generator.generateTableConstraints(meta);
    expect(constraints2.some((c) => c.includes('INDEX') && c.includes('custom_idx'))).toBe(true);
    delete (meta.fields.name as { index?: boolean | string }).index;
  });

  it('getSqlType with vector', () => {
    const field: FieldOptions = { type: 'vector' as ColumnType };
    expect(generator.getSqlType(field)).toBe('VECTOR');
  });

  it('getSqlType with various types', () => {
    expect(generator.getSqlType({ type: Number })).toBe('BIGINT');
    expect(generator.getSqlType({ type: Boolean })).toBe('BOOLEAN');
    expect(generator.getSqlType({ type: Date })).toBe('TIMESTAMP');
    expect(generator.getSqlType({ type: BigInt })).toBe('BIGINT');
    expect(generator.getSqlType({ type: 'unknown' as ColumnType })).toBe('VARCHAR(255)');
  });

  it('formatDefaultValue with boolean and Date', () => {
    expect(generator.formatDefaultValue(true)).toBe('TRUE');
    expect(generator.formatDefaultValue(false)).toBe('FALSE');
    const date = new Date('2023-01-01');
    expect(generator.formatDefaultValue(date)).toBe(`'${date.toISOString()}'`);
    expect(generator.formatDefaultValue({} as unknown as object)).toBe('[object Object]');
  });
});
