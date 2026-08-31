import { createTableNode } from '../schema/schemaAST.js';
import type { ColumnNode, TableNode } from '../schema/types.js';

/**
 * A table node built from the little each test cares about, with the rest defaulted. `schema` is the
 * namespace it sits in, left out for the ordinary unqualified table.
 */
export function mockTableNode(name: string, columns: Partial<ColumnNode>[], schema?: string): TableNode {
  const table = createTableNode(name, schema);

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
