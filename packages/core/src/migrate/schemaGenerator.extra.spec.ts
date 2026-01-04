import { describe, expect, it } from 'vitest';
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
    expect(generator.getSqlType({ type: 'uuid' })).toBe('UUID');
    expect(generator.getSqlType({ type: 'json' })).toBe('JSON');
    expect(generator.getSqlType({ type: 'jsonb' })).toBe('JSONB');
    expect(generator.getSqlType({ type: 'vector' })).toBe('VECTOR');
    // Test ternary branch where type !== field.type
    expect(generator.getSqlType({ type: 'uuid' }, String)).toBe('UUID');
    expect(generator.getSqlType({ type: 'json' }, String)).toBe('JSON');
    expect(generator.getSqlType({ type: 'vector' }, String)).toBe('VECTOR');
    expect(generator.getSqlType({ type: 'unknown' as ColumnType })).toBe('VARCHAR(255)');
  });

  it('formatDefaultValue with boolean and Date', () => {
    expect(generator.formatDefaultValue(true)).toBe('TRUE');
    expect(generator.formatDefaultValue(false)).toBe('FALSE');
    const date = new Date('2023-01-01');
    expect(generator.formatDefaultValue(date)).toBe(`'${date.toISOString()}'`);
    expect(generator.formatDefaultValue({} as unknown as object)).toBe('[object Object]');
  });

  describe('columnsNeedAlteration type normalization', () => {
    it('should normalize precision and scale in type comparison', () => {
      // Create an entity with a decimal field
      @Entity()
      class DecimalEntity {
        @Id() id?: number;
        @Field({ columnType: 'decimal', precision: 10, scale: 2 }) price?: number;
      }

      // Current schema has DECIMAL without precision in type string but with precision/scale properties
      const currentSchema = {
        name: 'DecimalEntity',
        columns: [
          { name: 'id', type: 'BIGINT', nullable: false, isPrimaryKey: true, isAutoIncrement: true, isUnique: false },
          {
            name: 'price',
            type: 'DECIMAL',
            precision: 10,
            scale: 2,
            nullable: true,
            isPrimaryKey: false,
            isAutoIncrement: false,
            isUnique: false,
          },
        ],
      };

      const diff = generator.diffSchema(DecimalEntity, currentSchema);
      // Should not detect alteration since types match after normalization
      expect(diff).toBeUndefined();
    });

    it('should normalize precision-only types', () => {
      @Entity()
      class PrecisionEntity {
        @Id() id?: number;
        @Field({ columnType: 'numeric', precision: 5 }) count?: number;
      }

      const currentSchema = {
        name: 'PrecisionEntity',
        columns: [
          { name: 'id', type: 'BIGINT', nullable: false, isPrimaryKey: true, isAutoIncrement: true, isUnique: false },
          {
            name: 'count',
            type: 'NUMERIC',
            precision: 5,
            nullable: true,
            isPrimaryKey: false,
            isAutoIncrement: false,
            isUnique: false,
          },
        ],
      };

      const diff = generator.diffSchema(PrecisionEntity, currentSchema);
      expect(diff).toBeUndefined();
    });
  });

  describe('columnsNeedAlteration default value comparison', () => {
    it('should treat null and string "NULL" as equal', () => {
      @Entity()
      class NullDefaultEntity {
        @Id() id?: number;
        @Field({ defaultValue: null }) status?: string;
      }

      const currentSchema = {
        name: 'NullDefaultEntity',
        columns: [
          { name: 'id', type: 'BIGINT', nullable: false, isPrimaryKey: true, isAutoIncrement: true, isUnique: false },
          {
            name: 'status',
            type: 'VARCHAR(255)',
            nullable: true,
            defaultValue: null as string,
            isPrimaryKey: false,
            isAutoIncrement: false,
            isUnique: false,
          },
        ],
      };

      const diff = generator.diffSchema(NullDefaultEntity, currentSchema);
      expect(diff).toBeUndefined();
    });

    it('should handle Postgres type casts in default values', () => {
      @Entity()
      class TypeCastEntity {
        @Id() id?: number;
        @Field({ defaultValue: 'active' }) status?: string;
      }

      const currentSchema = {
        name: 'TypeCastEntity',
        columns: [
          { name: 'id', type: 'BIGINT', nullable: false, isPrimaryKey: true, isAutoIncrement: true, isUnique: false },
          {
            name: 'status',
            type: 'VARCHAR(255)',
            nullable: true,
            defaultValue: "'active'::character varying",
            isPrimaryKey: false,
            isAutoIncrement: false,
            isUnique: false,
          },
        ],
      };

      const diff = generator.diffSchema(TypeCastEntity, currentSchema);
      expect(diff).toBeUndefined();
    });

    it('should handle Postgres array type casts in default values', () => {
      @Entity()
      class ArrayCastEntity {
        @Id() id?: number;
        @Field({ type: 'jsonb', defaultValue: [] }) tags?: string[];
      }

      const currentSchema = {
        name: 'ArrayCastEntity',
        columns: [
          { name: 'id', type: 'BIGINT', nullable: false, isPrimaryKey: true, isAutoIncrement: true, isUnique: false },
          {
            name: 'tags',
            type: 'JSONB',
            nullable: true,
            defaultValue: "'[]'::jsonb[]",
            isPrimaryKey: false,
            isAutoIncrement: false,
            isUnique: false,
          },
        ],
      };

      const diff = generator.diffSchema(ArrayCastEntity, currentSchema);
      expect(diff).toBeUndefined();
    });

    it('should handle quoted string defaults', () => {
      @Entity()
      class QuotedDefaultEntity {
        @Id() id?: number;
        @Field({ defaultValue: 'hello' }) greeting?: string;
      }

      const currentSchema = {
        name: 'QuotedDefaultEntity',
        columns: [
          { name: 'id', type: 'BIGINT', nullable: false, isPrimaryKey: true, isAutoIncrement: true, isUnique: false },
          {
            name: 'greeting',
            type: 'VARCHAR(255)',
            nullable: true,
            defaultValue: "'hello'",
            isPrimaryKey: false,
            isAutoIncrement: false,
            isUnique: false,
          },
        ],
      };

      const diff = generator.diffSchema(QuotedDefaultEntity, currentSchema);
      expect(diff).toBeUndefined();
    });

    it('should detect actual default value changes', () => {
      @Entity()
      class ChangedDefaultEntity {
        @Id() id?: number;
        @Field({ defaultValue: 'new_value' }) status?: string;
      }

      const currentSchema = {
        name: 'ChangedDefaultEntity',
        columns: [
          { name: 'id', type: 'BIGINT', nullable: false, isPrimaryKey: true, isAutoIncrement: true, isUnique: false },
          {
            name: 'status',
            type: 'VARCHAR(255)',
            nullable: true,
            defaultValue: 'old_value',
            isPrimaryKey: false,
            isAutoIncrement: false,
            isUnique: false,
          },
        ],
      };

      const diff = generator.diffSchema(ChangedDefaultEntity, currentSchema);
      expect(diff).toBeDefined();
      expect(diff.columnsToAlter).toHaveLength(1);
      expect(diff.columnsToAlter[0].to.name).toBe('status');
    });

    it('should handle numeric default values', () => {
      @Entity()
      class NumericDefaultEntity {
        @Id() id?: number;
        @Field({ defaultValue: 42 }) count?: number;
      }

      const currentSchema = {
        name: 'NumericDefaultEntity',
        columns: [
          { name: 'id', type: 'BIGINT', nullable: false, isPrimaryKey: true, isAutoIncrement: true, isUnique: false },
          {
            name: 'count',
            type: 'BIGINT',
            nullable: true,
            defaultValue: 42,
            isPrimaryKey: false,
            isAutoIncrement: false,
            isUnique: false,
          },
        ],
      };

      const diff = generator.diffSchema(NumericDefaultEntity, currentSchema);
      expect(diff).toBeUndefined();
    });
  });

  describe('normalizeType edge cases', () => {
    it('should strip display width from integer types', () => {
      @Entity()
      class IntDisplayWidthEntity {
        @Id() id?: number;
        @Field({ columnType: 'int' }) count?: number;
      }

      const currentSchema = {
        name: 'IntDisplayWidthEntity',
        columns: [
          { name: 'id', type: 'BIGINT', nullable: false, isPrimaryKey: true, isAutoIncrement: true, isUnique: false },
          {
            name: 'count',
            type: 'INT(11)',
            nullable: true,
            isPrimaryKey: false,
            isAutoIncrement: false,
            isUnique: false,
          },
        ],
      };

      const diff = generator.diffSchema(IntDisplayWidthEntity, currentSchema);
      expect(diff).toBeUndefined();
    });

    it('should handle MySQL UNSIGNED with display width', () => {
      @Entity()
      class UnsignedEntity {
        @Id() id?: number;
        @Field({ columnType: 'bigint' }) count?: number;
      }

      const currentSchema = {
        name: 'UnsignedEntity',
        columns: [
          { name: 'id', type: 'BIGINT', nullable: false, isPrimaryKey: true, isAutoIncrement: true, isUnique: false },
          {
            name: 'count',
            type: 'BIGINT(20) UNSIGNED',
            nullable: true,
            isPrimaryKey: false,
            isAutoIncrement: false,
            isUnique: false,
          },
        ],
      };

      const diff = generator.diffSchema(UnsignedEntity, currentSchema);
      expect(diff).toBeUndefined();
    });

    it('should handle Postgres IDENTITY variations', () => {
      @Entity()
      class IdentityEntity {
        @Id() id?: number;
      }

      const currentSchema = {
        name: 'IdentityEntity',
        columns: [
          {
            name: 'id',
            type: 'BIGINT GENERATED ALWAYS AS IDENTITY',
            nullable: false,
            isPrimaryKey: true,
            isAutoIncrement: true,
            isUnique: false,
          },
        ],
      };

      const diff = generator.diffSchema(IdentityEntity, currentSchema);
      expect(diff).toBeUndefined();
    });
  });

  describe('isDefaultValueEqual advanced casts', () => {
    it('should handle multi-word Postgres type casts', () => {
      @Entity()
      class MultiWordCastEntity {
        @Id() id?: number;
        @Field({ defaultValue: '2023-01-01' }) created?: Date;
      }

      const currentSchema = {
        name: 'MultiWordCastEntity',
        columns: [
          { name: 'id', type: 'BIGINT', nullable: false, isPrimaryKey: true, isAutoIncrement: true, isUnique: false },
          {
            name: 'created',
            type: 'TIMESTAMP',
            nullable: true,
            defaultValue: "'2023-01-01'::timestamp without time zone",
            isPrimaryKey: false,
            isAutoIncrement: false,
            isUnique: false,
          },
        ],
      };

      const diff = generator.diffSchema(MultiWordCastEntity, currentSchema);
      expect(diff).toBeUndefined();
    });
  });

  describe('polymorphic type mapping', () => {
    it('should map Date to dialect-specific types', () => {
      expect(generator.getSqlType({ type: Date })).toBe('TIMESTAMP');

      const typeMap: Record<string, string> = { timestamp: 'TEXT' };
      class SqliteTestGenerator extends TestSchemaGenerator {
        override mapColumnType(columnType: ColumnType): string {
          return typeMap[columnType] ?? columnType.toUpperCase();
        }
      }
      const sqliteGen = new SqliteTestGenerator();
      expect(sqliteGen.getSqlType({ type: Date })).toBe('TEXT');
    });
  });

  describe('generateColumnDefinitionFromSchema options', () => {
    it('should include PRIMARY KEY when includePrimaryKey is true', () => {
      const col: ColumnSchema = {
        name: 'id',
        type: 'INTEGER',
        nullable: false,
        isPrimaryKey: true,
        isAutoIncrement: true,
        isUnique: false,
      };
      const sql = generator.generateColumnDefinitionFromSchema(col, { includePrimaryKey: true });
      expect(sql).toContain('PRIMARY KEY');
    });

    it('should exclude PRIMARY KEY when includePrimaryKey is false', () => {
      const col: ColumnSchema = {
        name: 'id',
        type: 'INTEGER',
        nullable: false,
        isPrimaryKey: true,
        isAutoIncrement: true,
        isUnique: false,
      };
      const sql = generator.generateColumnDefinitionFromSchema(col, { includePrimaryKey: false });
      expect(sql).not.toContain('PRIMARY KEY');
    });
  });
});
