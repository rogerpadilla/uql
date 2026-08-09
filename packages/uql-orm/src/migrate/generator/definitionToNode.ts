import type { ColumnNode, RelationshipNode, TableNode } from '../../schema/types.js';
import type { FullColumnDefinition, TableDefinition } from '../builder/types.js';

/**
 * A migration builder's table definition as the AST nodes the generators render from, so a hand-written
 * `createTable` and an entity reach `generateCreateTableFromNode` in the same shape. Free functions and
 * not generator methods: nothing here consults the dialect.
 */
export function tableDefinitionToNode(def: TableDefinition): TableNode {
  const columns = new Map<string, ColumnNode>();
  const pkNodes: ColumnNode[] = [];

  const table: TableNode = {
    name: def.name,
    columns,
    primaryKey: [], // placeholder
    indexes: [],
    schema: { tables: new Map(), relationships: [], indexes: [] },
    incomingRelations: [],
    outgoingRelations: [],
    comment: def.comment,
  };

  for (const colDef of def.columns) {
    const node = fullColumnDefinitionToNode(colDef, def.name);
    (node as { table: TableNode }).table = table;
    columns.set(node.name, node);
    if (node.isPrimaryKey) {
      pkNodes.push(node);
    }
  }

  const finalPrimaryKey = def.primaryKey
    ? def.primaryKey.map((name) => columns.get(name)).filter((c): c is ColumnNode => c !== undefined)
    : pkNodes;

  (table as { primaryKey: ColumnNode[] }).primaryKey = finalPrimaryKey;

  for (const idxDef of def.indexes) {
    table.indexes.push({ ...idxDef, table });
  }

  for (const fkDef of def.foreignKeys) {
    const relNode: RelationshipNode = {
      name: fkDef.name ?? `fk_${def.name}_${fkDef.columns.join('_')}`,
      type: 'ManyToOne', // Builder default
      from: {
        table,
        columns: fkDef.columns.map((name) => columns.get(name)).filter((c): c is ColumnNode => c !== undefined),
      },
      to: {
        table: { name: fkDef.referencesTable } as TableNode,
        columns: fkDef.referencesColumns.map((name) => ({ name }) as ColumnNode),
      },
      onDelete: fkDef.onDelete,
      onUpdate: fkDef.onUpdate,
    };
    table.outgoingRelations.push(relNode);
  }

  return table;
}

export function fullColumnDefinitionToNode(col: FullColumnDefinition, tableName: string): ColumnNode {
  return {
    name: col.name,
    type: col.type,
    nullable: col.nullable,
    defaultValue: col.defaultValue,
    isPrimaryKey: col.primaryKey,
    isAutoIncrement: col.autoIncrement,
    isUnique: col.unique,
    comment: col.comment,
    table: { name: tableName } as TableNode,
    referencedBy: [],
    references: col.foreignKey
      ? {
          name: `fk_${tableName}_${col.name}`,
          type: 'ManyToOne',
          from: { table: { name: tableName } as TableNode, columns: [] },
          to: {
            table: { name: col.foreignKey.table } as TableNode,
            columns: col.foreignKey.columns.map((name) => ({ name }) as ColumnNode),
          },
          onDelete: col.foreignKey.onDelete,
          onUpdate: col.foreignKey.onUpdate,
        }
      : undefined,
  };
}
