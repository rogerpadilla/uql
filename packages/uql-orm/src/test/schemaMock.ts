import { SchemaAST } from '../schema/schemaAST.js';
import type { ColumnNode, TableNode } from '../schema/types.js';

/**
 * A table node built from the little each test cares about, with the rest defaulted. Its `schema` is
 * an empty AST rather than a stand-in: a test that needs the graph adds the table to one of its own,
 * and `addTable` reassigns it.
 */
export function mockTableNode(name: string, columns: Partial<ColumnNode>[]): TableNode {
  const table: TableNode = {
    name,
    columns: new Map(),
    primaryKey: [],
    indexes: [],
    incomingRelations: [],
    outgoingRelations: [],
    schema: new SchemaAST(),
  };

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
    if (column.isPrimaryKey) {
      table.primaryKey.push(column);
    }
  }

  return table;
}
