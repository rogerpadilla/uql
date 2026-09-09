import type { ColumnNode, RelationshipNode, TableNode } from '../../schema/types.js';
import type { ForeignKeySchema, IndexSchema } from '../../type/migration.js';
import { derivedForeignKeyName, derivedIndexName } from '../../util/sql.util.js';
import type { FullColumnDefinition, TableDefinition } from '../builder/types.js';

/**
 * A table the builder names but has not seen.
 *
 * A `RelationshipNode` points at a whole `TableNode` because the AST wires `incomingRelations` through
 * it; a builder creating one table has no node for the table its foreign key targets, and the
 * generator reads only the name. Stated once, so the three casts it replaces cannot be mistaken for a
 * node that was resolved and lost.
 */
function unresolvedTable(name: string): TableNode {
  return { name } as TableNode;
}

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
 * A builder's column as the AST node the generators render from.
 *
 * The shared half is spread, not copied field by field: `ColumnDefinition` *is* a `ColumnNode` minus
 * the graph links, so spreading it and adding those back is a node by construction. Listed one by one,
 * the copy silently dropped whatever the node gained next - `enum` first, and the type had no way to
 * say so. The two builder-only keys are destructured off: `index` and `foreignKey` are lifted onto the
 * table by `columnIndex`/`columnForeignKey`, which is the path that renders them.
 *
 * No `references` node either: `SchemaAST.addRelationship` sets that one.
 */
export function fullColumnDefinitionToNode(col: FullColumnDefinition, tableName: string): ColumnNode {
  const { index: _index, foreignKey: _foreignKey, ...column } = col;
  return { ...column, table: unresolvedTable(tableName), referencedBy: [] };
}

/**
 * The index a column-level `index` declares, or nothing.
 *
 * Shared with `TableBuilder.build`, which lifts these into the table it is creating: written twice,
 * `addColumn` had no lift at all and silently emitted a column with no index.
 */
export function columnIndex(tableName: string, col: FullColumnDefinition): IndexSchema | undefined {
  if (!col.index) {
    return undefined;
  }
  return {
    name: typeof col.index === 'string' ? col.index : derivedIndexName(tableName, [col.name]),
    entries: [{ column: col.name }],
    unique: col.isUnique,
  };
}

/** The foreign key a column-level `references` declares, or nothing. Shared for the same reason. */
export function columnForeignKey(col: FullColumnDefinition): ForeignKeySchema | undefined {
  if (!col.foreignKey) {
    return undefined;
  }
  return { ...col.foreignKey, columns: [col.name] };
}
