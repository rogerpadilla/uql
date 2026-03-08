import { describe, expect, it } from 'vitest';
import { Entity, Field, Id } from '../entity/index.js';
import { sqlToCanonical } from '../schema/canonicalType.js';
import { SchemaAST } from '../schema/schemaAST.js';
import type { ColumnNode, TableNode } from '../schema/types.js';
import { SqlSchemaGenerator } from './schemaGenerator.js';

@Entity()
class DiffUser {
  @Id() id?: number;
  @Field({ columnType: 'varchar', length: 255 }) name?: string;
  @Field({ columnType: 'varchar', length: 100 }) email?: string;
  @Field({ columnType: 'varchar', length: 255, index: true }) status?: string;
}

describe('SqlSchemaGenerator Advanced', () => {
  const generator = new SqlSchemaGenerator('postgres');
  const ast = new SchemaAST();

  it('diffSchema should detect new columns', () => {
    const currentSchema = createTableNode('DiffUser', ast, [
      { name: 'id', sql: 'INTEGER', isPrimaryKey: true, isAutoIncrement: true },
      { name: 'name', sql: 'VARCHAR', length: 255 },
    ]);

    const diff = generator.diffSchema(DiffUser, currentSchema);

    expect(diff).toBeDefined();
    expect(diff?.type).toBe('alter');
    expect(diff?.columnsToAdd).toHaveLength(2);
    expect(diff?.columnsToAdd?.[0].name).toBe('email');
    expect(diff?.columnsToAdd?.[1].name).toBe('status');
  });

  it('diffSchema should detect altered columns (type change)', () => {
    const currentSchema = createTableNode('DiffUser', ast, [
      { name: 'id', sql: 'BIGINT', isPrimaryKey: true, isAutoIncrement: true },
      { name: 'name', sql: 'TEXT' },
      { name: 'email', sql: 'VARCHAR', length: 50 },
      { name: 'status', sql: 'VARCHAR', length: 255 },
    ]);

    const diff = generator.diffSchema(DiffUser, currentSchema);

    expect(diff).toBeDefined();
    expect(diff?.type).toBe('alter');
    expect(diff?.columnsToAlter).toHaveLength(2);
    expect(diff?.columnsToAlter?.map((c) => c.to.name)).toContain('name');
    expect(diff?.columnsToAlter?.map((c) => c.to.name)).toContain('email');
  });

  it('diffSchema should detect columns to drop', () => {
    const currentSchema = createTableNode('DiffUser', ast, [
      { name: 'id', sql: 'INTEGER', isPrimaryKey: true, isAutoIncrement: true },
      { name: 'name', sql: 'VARCHAR', length: 255 },
      { name: 'email', sql: 'VARCHAR', length: 100 },
      { name: 'status', sql: 'VARCHAR', length: 255 },
      { name: 'old_col', sql: 'VARCHAR' },
    ]);

    const diff = generator.diffSchema(DiffUser, currentSchema);

    expect(diff).toBeDefined();
    expect(diff?.type).toBe('alter');
    expect(diff?.columnsToDrop).toEqual(['old_col']);
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
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "idx_age" ON "users" ("age");');
    expect(sql).toContain('DROP INDEX IF EXISTS "idx_old";');
  });
});

/**
 * Helper to create a TableNode with columns.
 */
function createTableNode(
  name: string,
  ast: SchemaAST,
  cols: { name: string; sql: string; length?: number; isPrimaryKey?: boolean; isAutoIncrement?: boolean }[],
): TableNode {
  const columns = new Map<string, ColumnNode>();
  const table: TableNode = {
    name,
    columns,
    primaryKey: [],
    indexes: [],
    schema: ast,
    incomingRelations: [],
    outgoingRelations: [],
  };

  for (const col of cols) {
    const type = {
      ...sqlToCanonical(col.sql),
      ...(col.length ? { length: col.length } : {}),
    };
    columns.set(col.name, {
      name: col.name,
      type,
      nullable: !col.isPrimaryKey,
      isPrimaryKey: !!col.isPrimaryKey,
      isAutoIncrement: !!col.isAutoIncrement,
      isUnique: false,
      table,
      referencedBy: [],
    });
  }

  return table;
}
