import { describe, expect, it } from 'vitest';
import { Entity, Field, Id } from '../entity/index.js';
import type { TableSchema } from '../type/index.js';
import { PostgresSchemaGenerator } from './generator/postgresSchemaGenerator.js';

@Entity()
class DiffUser {
  @Id() id?: number;
  @Field({ columnType: 'varchar', length: 255 }) name?: string;
  @Field({ columnType: 'varchar', length: 100 }) email?: string;
  @Field({ columnType: 'varchar', length: 255, index: true }) status?: string;
}

describe('AbstractSchemaGenerator (via Postgres)', () => {
  const generator = new PostgresSchemaGenerator();

  it('diffSchema should detect new columns', () => {
    const currentSchema: TableSchema = {
      name: 'DiffUser',
      columns: [
        { name: 'id', type: 'INTEGER', nullable: false, isPrimaryKey: true, isAutoIncrement: true, isUnique: false },
        {
          name: 'name',
          type: 'VARCHAR',
          length: 255,
          nullable: true,
          isPrimaryKey: false,
          isAutoIncrement: false,
          isUnique: false,
        },
      ],
    };

    const diff = generator.diffSchema(DiffUser, currentSchema);

    expect(diff).toBeDefined();
    expect(diff.type).toBe('alter');
    expect(diff.columnsToAdd).toHaveLength(2);
    expect(diff.columnsToAdd[0].name).toBe('email');
    expect(diff.columnsToAdd[1].name).toBe('status');
  });

  it('diffSchema should detect altered columns (type change)', () => {
    const currentSchema: TableSchema = {
      name: 'DiffUser',
      columns: [
        { name: 'id', type: 'BIGINT', nullable: false, isPrimaryKey: true, isAutoIncrement: true, isUnique: false },
        { name: 'name', type: 'TEXT', nullable: true, isPrimaryKey: false, isAutoIncrement: false, isUnique: false },
        {
          name: 'email',
          type: 'VARCHAR',
          length: 50,
          nullable: true,
          isPrimaryKey: false,
          isAutoIncrement: false,
          isUnique: false,
        },
        {
          name: 'status',
          type: 'VARCHAR',
          length: 255,
          nullable: true,
          isPrimaryKey: false,
          isAutoIncrement: false,
          isUnique: false,
        },
      ],
    };

    const diff = generator.diffSchema(DiffUser, currentSchema);

    expect(diff).toBeDefined();
    expect(diff.type).toBe('alter');
    // Note: Primary key (id) is skipped from alteration for safety
    expect(diff.columnsToAlter).toHaveLength(2);
    expect(diff.columnsToAlter[0].to.name).toBe('name');
    expect(diff.columnsToAlter[1].to.name).toBe('email');
  });

  it('diffSchema should detect columns to drop', () => {
    const currentSchema: TableSchema = {
      name: 'DiffUser',
      columns: [
        { name: 'id', type: 'INTEGER', nullable: false, isPrimaryKey: true, isAutoIncrement: true, isUnique: false },
        { name: 'name', type: 'VARCHAR', nullable: true, isPrimaryKey: false, isAutoIncrement: false, isUnique: false },
        {
          name: 'email',
          type: 'VARCHAR',
          length: 100,
          nullable: true,
          isPrimaryKey: false,
          isAutoIncrement: false,
          isUnique: false,
        },
        {
          name: 'status',
          type: 'VARCHAR',
          nullable: true,
          isPrimaryKey: false,
          isAutoIncrement: false,
          isUnique: false,
        },
        {
          name: 'old_col',
          type: 'VARCHAR',
          nullable: true,
          isPrimaryKey: false,
          isAutoIncrement: false,
          isUnique: false,
        },
      ],
    };

    const diff = generator.diffSchema(DiffUser, currentSchema);

    expect(diff).toBeDefined();
    expect(diff.type).toBe('alter');
    expect(diff.columnsToDrop).toEqual(['old_col']);
  });

  it('generateAlterTable should produce correct SQL', () => {
    const sql = generator.generateAlterTable({
      tableName: 'users',
      type: 'alter',
      columnsToAdd: [
        { name: 'age', type: 'INTEGER', nullable: true, isPrimaryKey: false, isAutoIncrement: false, isUnique: false },
      ],
      columnsToDrop: ['old_name'],
      indexesToAdd: [{ name: 'idx_age', columns: ['age'], unique: false }],
      indexesToDrop: ['idx_old'],
    });

    expect(sql).toContain('ALTER TABLE "users" ADD COLUMN "age" INTEGER;');
    expect(sql).toContain('ALTER TABLE "users" DROP COLUMN "old_name";');
    expect(sql).toContain('CREATE INDEX "idx_age" ON "users" ("age");');
    expect(sql).toContain('DROP INDEX IF EXISTS "idx_old";');
  });
});
