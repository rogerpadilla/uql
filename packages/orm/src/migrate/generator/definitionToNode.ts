import { createTableNode, keyOfColumns } from '../../schema/schemaAST.js';
import type { ColumnNode, RelationshipNode, TableNode } from '../../schema/types.js';
import type { ForeignKeySchema, IndexSchema } from '../../type/migration.js';
import type { QueryRaw } from '../../type/queryRaw.js';
import { renderIndexColumn } from '../../util/ddlExpression.util.js';
import { derivedForeignKeyName, derivedIndexName } from '../../util/sql.util.js';
import type { FullColumnDefinition, IndexDefinition, TableDefinition } from '../builder/types.js';

/** A table the builder names but has not seen, which the generator reads only the name of. */
function unresolvedTable(name: string): TableNode {
  return { name } as TableNode;
}

/**
 * A migration builder's table definition as the AST nodes the generators render from, so a hand-written
 * `createTable` and an entity reach `generateCreateTableFromNode` in the same shape, its SQL rendered by
 * `render`. Free functions and not generator methods: the dialect reaches them only through `render`.
 */
export function tableDefinitionToNode(def: TableDefinition, render: (sql: QueryRaw) => string): TableNode {
  const table: TableNode = { ...createTableNode(def.name), comment: def.comment };
  const { columns } = table;

  for (const colDef of def.columns) {
    const node = fullColumnDefinitionToNode(colDef, def.name);
    (node as { table: TableNode }).table = table;
    columns.set(node.name, node);
  }
  // A declared key keeps only the columns the table has, in its own order.
  table.primaryKey = def.primaryKey
    ? { columns: def.primaryKey.filter((name) => columns.has(name)) }
    : keyOfColumns(columns.values());

  for (const idxDef of def.indexes) {
    table.indexes.push({ ...renderIndexDefinition(idxDef, render), table });
  }

  for (const fkDef of def.foreignKeys) {
    const relNode: RelationshipNode = {
      name: fkDef.name ?? derivedForeignKeyName(def.name, fkDef.columns),
      type: 'ManyToOne', // Builder default
      from: {
        table,
        columns: fkDef.columns.map((name) => columns.get(name)).filter((c): c is ColumnNode => c !== undefined),
      },
      to: {
        table: unresolvedTable(fkDef.references.table),
        columns: fkDef.references.columns.map((name) => ({ name }) as ColumnNode),
      },
      onDelete: fkDef.onDelete,
      onUpdate: fkDef.onUpdate,
    };
    table.outgoingRelations.push(relNode);
  }

  return table;
}

/**
 * A builder's column as the node the generators render, spread so a field the node gains carries over.
 * `index` and `foreignKey` are lifted onto the table elsewhere; `addRelationship` sets `references`.
 */
export function fullColumnDefinitionToNode(col: FullColumnDefinition, tableName: string): ColumnNode {
  const { index: _index, foreignKey: _foreignKey, ...column } = col;
  return { ...column, table: unresolvedTable(tableName), referencedBy: [] };
}

/**
 * The index a column-level `index` or `unique` declares, or nothing: a unique column is a unique index.
 *
 * Shared with `TableBuilder.build`, which lifts these into the table it is creating: written twice,
 * `addColumn` had no lift at all and silently emitted a column with no index.
 */
export function columnIndex(
  tableName: string,
  col: FullColumnDefinition,
): Pick<IndexSchema, 'name' | 'entries' | 'unique'> | undefined {
  if (!col.index && !col.isUnique) {
    return undefined;
  }
  return {
    name: typeof col.index === 'string' ? col.index : derivedIndexName(tableName, [col.name]),
    entries: [{ column: col.name }],
    unique: col.isUnique,
  };
}

/** An index the builder recorded, its SQL rendered by `render` into the text the schema holds. */
export function renderIndexDefinition(index: IndexDefinition, render: (sql: QueryRaw) => string): IndexSchema {
  return {
    ...index,
    entries: index.entries.map((entry) => renderIndexColumn(entry, render)),
    where: index.where && render(index.where),
  };
}

/** The foreign key a column-level `references` declares, or nothing. Shared for the same reason. */
export function columnForeignKey(col: FullColumnDefinition): ForeignKeySchema | undefined {
  if (!col.foreignKey) {
    return undefined;
  }
  return { ...col.foreignKey, columns: [col.name] };
}
