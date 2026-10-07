import type { AbstractSqlDialect } from '../dialect/index.js';
import { canonicalToSql, resolveColumnCanonicalType, sqlToCanonical } from '../schema/canonicalType.js';
import type { IndexFacet } from '../schema/indexDifferences.js';
import { createTableNode, keyOfColumns, SchemaAST } from '../schema/schemaAST.js';
import type { ColumnNode, TableNode } from '../schema/types.js';
import type { FieldMeta } from '../type/index.js';
import { assertDefined } from './spec.util.js';

/**
 * A table node built from the little each test cares about, with the rest defaulted. `schema` is the
 * namespace it sits in, left out for the ordinary unqualified table; `indexFacets` what its reader reports.
 */
export function mockTableNode(
  name: string,
  columns: Partial<ColumnNode>[],
  schema?: string,
  indexFacets?: ReadonlySet<IndexFacet>,
): TableNode {
  const table = createTableNode(name, schema, indexFacets);

  for (const col of columns) {
    const column: ColumnNode = {
      name: col.name || 'unknown',
      type: col.type || { category: 'string' },
      nullable: col.nullable ?? true,
      isPrimaryKey: col.isPrimaryKey ?? false,
      isAutoIncrement: col.isAutoIncrement ?? false,
      isUnique: col.isUnique ?? false,
      table,
      referencedBy: [],
      ...col,
    };
    table.columns.set(column.name, column);
  }
  table.primaryKey = keyOfColumns(table.columns.values());

  return table;
}

/** A table as a database holds it, each column typed the way the engine spells it (`VARCHAR`, `BIGINT`). */
export function mockSqlTableNode(
  name: string,
  columns: (Partial<ColumnNode> & { readonly name: string; readonly sql: string; readonly length?: number })[],
): TableNode {
  return mockTableNode(
    name,
    columns.map(({ sql, length, ...column }) => ({
      nullable: !column.isPrimaryKey,
      ...column,
      type: { ...sqlToCanonical(sql), length },
    })),
  );
}

/** The columns of `table` the names give, in order, failing the test where one is missing. */
export function columnsOf(table: TableNode, ...names: string[]): ColumnNode[] {
  return names.map((name) => {
    const column = table.columns.get(name);
    assertDefined(column, `${table.name} has no column ${name}`);
    return column;
  });
}

/**
 * A schema with a column of every kind `generate:from-db` declares differently, whose generated entities are
 * checked in under `test/generated/`: `bun run ts` compiles them, and the generator's spec compares them.
 */
export function mockGeneratedSchema(): SchemaAST {
  const ast = new SchemaAST();
  const users = mockTableNode('users', [
    { name: 'id', type: { category: 'integer' }, isPrimaryKey: true, isAutoIncrement: true, nullable: false },
    { name: 'email', type: { category: 'string', length: 255 }, nullable: false, isUnique: true },
    { name: 'name', type: { category: 'string' } },
    { name: 'settings', type: { category: 'json' }, nullable: false, defaultValue: '{}' },
    { name: 'manager_id', type: { category: 'integer' } },
  ]);
  const posts = mockTableNode('posts', [
    { name: 'id', type: { category: 'uuid' }, isPrimaryKey: true, nullable: false },
    { name: 'author_id', type: { category: 'integer' }, nullable: false },
    { name: 'editor_id', type: { category: 'integer' } },
    { name: 'title', type: { category: 'string', length: 255 }, nullable: false },
    {
      name: 'state',
      type: { category: 'string', length: 10 },
      nullable: false,
      defaultValue: 'draft',
    },
    { name: 'views', type: { category: 'integer' }, nullable: false, defaultValue: 0 },
    { name: 'score', type: { category: 'integer' }, nullable: false, generatedAs: 'views * 2' },
    { name: 'published_at', type: { category: 'timestamp' } },
    { name: 'read_at', type: { category: 'time' } },
    { name: 'embedding', type: { category: 'vector', length: 3 } },
  ]);
  const regions = mockTableNode('regions', [
    { name: 'code', type: { category: 'integer' }, isPrimaryKey: true, nullable: false },
    { name: 'name', type: { category: 'string' }, nullable: false },
  ]);
  ast.addTable(users);
  ast.addTable(posts);
  ast.addTable(regions);
  ast.addRelationship({
    name: 'posts_author_id_fkey',
    type: 'ManyToOne',
    from: { table: posts, columns: columnsOf(posts, 'author_id') },
    to: { table: users, columns: columnsOf(users, 'id') },
  });
  ast.addRelationship({
    name: 'posts_editor_id_fkey',
    type: 'ManyToOne',
    from: { table: posts, columns: columnsOf(posts, 'editor_id') },
    to: { table: users, columns: columnsOf(users, 'id') },
  });
  ast.addRelationship({
    name: 'users_manager_id_fkey',
    type: 'ManyToOne',
    from: { table: users, columns: columnsOf(users, 'manager_id') },
    to: { table: users, columns: columnsOf(users, 'id') },
  });
  return ast;
}

/** The SQL type `dialect` writes for a field's column when the column is not a generated key. */
export function sqlTypeOf(dialect: AbstractSqlDialect, field: FieldMeta): string {
  return canonicalToSql(resolveColumnCanonicalType(field), dialect);
}
