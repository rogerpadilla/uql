import { describe, expect, it } from 'vitest';
import type { SchemaAST } from '../../schema/schemaAST.js';
import { SqliteDialect } from '../../sqlite/sqliteDialect.js';
import type { ColumnSchema, ForeignKeySchema, TableSchema } from '../../type/migration.js';
import { BaseSqlIntrospector } from './baseSqlIntrospector.js';

/** Builds the AST straight from canned table schemas, with no driver in the way. */
class StubIntrospector extends BaseSqlIntrospector {
  constructor(private readonly schemas: TableSchema[]) {
    super(new SqliteDialect({}));
  }

  override async getTableNames(): Promise<string[]> {
    return this.schemas.map((s) => s.name);
  }

  override async getTableSchema(tableName: string): Promise<TableSchema | undefined> {
    return this.schemas.find((s) => s.name === tableName);
  }
}

function column(overrides: Partial<ColumnSchema> & { name: string }): ColumnSchema {
  return {
    type: 'INTEGER',
    nullable: false,
    isPrimaryKey: false,
    isAutoIncrement: false,
    isUnique: false,
    ...overrides,
  };
}

const users: TableSchema = {
  name: 'users',
  columns: [column({ name: 'id', isPrimaryKey: true, isAutoIncrement: true })],
  primaryKey: ['id'],
};

/** `posts.authorId` referencing `users.id`, with the foreign key parts under test overridden. */
function postsWith(fk: Partial<ForeignKeySchema> = {}, authorId = column({ name: 'authorId' })) {
  return {
    name: 'posts',
    columns: [column({ name: 'id', isPrimaryKey: true, isAutoIncrement: true }), authorId],
    foreignKeys: [
      {
        name: 'fk_posts_authorId',
        columns: ['authorId'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        ...fk,
      },
    ],
  } satisfies TableSchema;
}

function introspect(schemas: TableSchema[]): Promise<SchemaAST> {
  return new StubIntrospector(schemas).introspect();
}

describe('BaseSqlIntrospector relationships', () => {
  it('should read a foreign key as a ManyToOne relationship wired to both tables', async () => {
    const ast = await introspect([users, postsWith({ onDelete: 'CASCADE', onUpdate: 'RESTRICT' })]);

    const [rel] = ast.relationships;
    expect(rel.name).toBe('fk_posts_authorId');
    expect(rel.type).toBe('ManyToOne');
    expect(rel.from.table.name).toBe('posts');
    expect(rel.from.columns.map((c) => c.name)).toEqual(['authorId']);
    expect(rel.to.table.name).toBe('users');
    expect(rel.to.columns.map((c) => c.name)).toEqual(['id']);
    expect(rel.onDelete).toBe('CASCADE');
    expect(rel.onUpdate).toBe('RESTRICT');
    expect(ast.getTable('posts')?.outgoingRelations).toHaveLength(1);
    expect(ast.getTable('users')?.incomingRelations).toHaveLength(1);
  });

  /** A unique foreign key column can only point at one row on each side. */
  it('should read a unique foreign key column as a OneToOne relationship', async () => {
    const ast = await introspect([users, postsWith({}, column({ name: 'authorId', isUnique: true }))]);

    expect(ast.relationships[0].type).toBe('OneToOne');
  });

  /** Engines report no action as an absent value; the AST needs it spelled out to diff against entities. */
  it('should default missing referential actions to NO ACTION', async () => {
    const ast = await introspect([users, postsWith()]);

    expect(ast.relationships[0].onDelete).toBe('NO ACTION');
    expect(ast.relationships[0].onUpdate).toBe('NO ACTION');
  });

  /** Introspecting a subset of the database (or a cross-schema reference) leaves dangling targets. */
  it('should skip a foreign key whose referenced table was not introspected', async () => {
    const ast = await introspect([postsWith()]);

    expect(ast.relationships).toHaveLength(0);
    expect(ast.getTable('posts')?.outgoingRelations).toHaveLength(0);
  });

  it('should skip a foreign key naming a column that does not exist', async () => {
    const ast = await introspect([users, postsWith({ columns: ['ghostId'] })]);

    expect(ast.relationships).toHaveLength(0);
  });

  it('should skip a foreign key naming a referenced column that does not exist', async () => {
    const ast = await introspect([users, postsWith({ referencedColumns: ['ghost'] })]);

    expect(ast.relationships).toHaveLength(0);
  });

  it('should leave tables without foreign keys unrelated', async () => {
    const ast = await introspect([users]);

    expect(ast.relationships).toHaveLength(0);
  });
});

describe('BaseSqlIntrospector indexes', () => {
  const indexed: TableSchema = {
    name: 'users',
    columns: [column({ name: 'id', isPrimaryKey: true }), column({ name: 'email', type: 'VARCHAR', length: 255 })],
    indexes: [
      { name: 'uq_users_email', entries: [{ column: 'email' }], unique: true },
      { name: 'idx_users_ghost', entries: [{ column: 'ghost' }], unique: false },
    ],
  };

  it('should read indexes over known columns and attach them to their table', async () => {
    const ast = await introspect([indexed]);

    expect(ast.getTableIndexes('users').map((i) => i.name)).toEqual(['uq_users_email']);
    expect(ast.getIndex('uq_users_email')?.unique).toBe(true);
    expect(ast.getIndex('uq_users_email')?.entries.map((entry) => entry.column)).toEqual(['email']);
  });

  it('should skip an index over a column that does not exist', async () => {
    const ast = await introspect([indexed]);

    expect(ast.getIndex('idx_users_ghost')).toBeUndefined();
  });
});

describe('BaseSqlIntrospector columns', () => {
  it('should keep the reported precision over the one parsed from the type', async () => {
    const ast = await introspect([
      {
        name: 'orders',
        columns: [column({ name: 'total', type: 'NUMERIC(10, 2)', precision: 12, scale: 4 })],
      },
    ]);

    expect(ast.getTable('orders')?.columns.get('total')?.type).toMatchObject({
      category: 'decimal',
      precision: 12,
      scale: 4,
    });
  });

  it('should fall back to the parameters carried by the type itself', async () => {
    const ast = await introspect([
      {
        name: 'orders',
        columns: [column({ name: 'code', type: 'VARCHAR(30)' })],
      },
    ]);

    expect(ast.getTable('orders')?.columns.get('code')?.type).toMatchObject({ category: 'string', length: 30 });
  });

  it('should skip a table the driver cannot describe', async () => {
    const introspector = new StubIntrospector([users]);
    introspector.getTableNames = async () => ['users', 'vanished'];

    const ast = await introspector.introspect();

    expect(ast.getTables().map((t) => t.name)).toEqual(['users']);
  });
});
