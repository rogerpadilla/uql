import { describe, expect, it } from 'vitest';
import { PostgresDialect } from '../dialect/index.js';
import { Entity, Field, Id } from '../entity/index.js';
import { sqlToCanonical } from '../schema/canonicalType.js';
import { SchemaAST } from '../schema/schemaAST.js';
import type { ColumnNode, TableNode } from '../schema/types.js';
import { raw } from '../util/index.js';
import { SqlSchemaGenerator } from './schemaGenerator.js';

@Entity()
class DiffUser {
  @Id() id?: number;
  @Field({ columnType: 'varchar', length: 255 }) name?: string;
  @Field({ columnType: 'varchar', length: 100 }) email?: string;
  @Field({ columnType: 'varchar', length: 255, index: true }) status?: string;
}

@Entity()
class DefaultsEntity {
  @Id() id?: number;
  @Field({ columnType: 'varchar', length: 20, defaultValue: 'active' }) status?: string;
  @Field({ columnType: 'int', defaultValue: 0 }) attempts?: number;
}

@Entity()
class VirtualEntity {
  @Id() id?: number;
  @Field({ virtual: raw('1 + 1') }) computed?: number;
}

describe('SqlSchemaGenerator Advanced', () => {
  const generator = new SqlSchemaGenerator(new PostgresDialect());
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

  /**
   * Introspected defaults come back in the engine's own spelling - quoted, cast, upper-cased - so
   * they are compared normalized against the entity's plain value. Anything else reports a permanent
   * difference and every `migrate` run would emit the same no-op ALTER.
   */
  it('diffSchema should treat engine-spelled defaults as unchanged', () => {
    const currentSchema = defaultsTableNode("'active'::character varying");

    expect(generator.diffSchema(DefaultsEntity, currentSchema)).toBeUndefined();
  });

  it('diffSchema should detect a genuinely changed default', () => {
    const currentSchema = defaultsTableNode("'inactive'::character varying");

    const diff = generator.diffSchema(DefaultsEntity, currentSchema);

    expect(diff?.columnsToAlter).toHaveLength(1);
    expect(diff?.columnsToAlter?.[0].from.defaultValue).toBe("'inactive'::character varying");
    expect(diff?.columnsToAlter?.[0].to.defaultValue).toBe('active');
  });

  it('diffSchema should detect a default replacing an existing NULL default', () => {
    const currentSchema = defaultsTableNode(null);

    const diff = generator.diffSchema(DefaultsEntity, currentSchema);

    expect(diff?.columnsToAlter).toHaveLength(1);
    expect(diff?.columnsToAlter?.[0].to.defaultValue).toBe('active');
  });

  it('diffSchema should detect a default added to a column that had none', () => {
    const currentSchema = defaultsTableNode(undefined);

    const diff = generator.diffSchema(DefaultsEntity, currentSchema);

    expect(diff?.columnsToAlter).toHaveLength(1);
    expect(diff?.columnsToAlter?.[0].to.defaultValue).toBe('active');
  });

  /** A virtual field is a query-time expression, never a column, so it must not show up as a diff. */
  it('diffSchema should skip virtual fields', () => {
    const currentSchema = createTableNode('VirtualEntity', ast, [
      { name: 'id', sql: 'INTEGER', isPrimaryKey: true, isAutoIncrement: true },
    ]);

    expect(generator.diffSchema(VirtualEntity, currentSchema)).toBeUndefined();
  });

  /** `DefaultsEntity` as it stands in the database, with `status`'s stored default under test. */
  function defaultsTableNode(statusDefault: unknown) {
    return createTableNode('DefaultsEntity', ast, [
      { name: 'id', sql: 'INTEGER', isPrimaryKey: true, isAutoIncrement: true },
      { name: 'status', sql: 'VARCHAR', length: 20, defaultValue: statusDefault },
      { name: 'attempts', sql: 'INTEGER', defaultValue: '0' },
    ]);
  }

  it('generateAlterTable should produce correct SQL', () => {
    const sql = generator.generateAlterTable({
      tableName: 'users',
      type: 'alter',
      columnsToAdd: [
        {
          name: 'age',
          type: 'INTEGER',
          nullable: true,
          isPrimaryKey: false,
          isAutoIncrement: false,
          isUnique: false,
        },
      ],
      columnsToDrop: ['old_name'],
      indexesToAdd: [{ name: 'idx_age', columns: [{ column: 'age' }], unique: false }],
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
  cols: {
    name: string;
    sql: string;
    length?: number;
    isPrimaryKey?: boolean;
    isAutoIncrement?: boolean;
    defaultValue?: unknown;
  }[],
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
      defaultValue: col.defaultValue,
      isPrimaryKey: !!col.isPrimaryKey,
      isAutoIncrement: !!col.isAutoIncrement,
      isUnique: false,
      table,
      referencedBy: [],
    });
  }

  return table;
}
