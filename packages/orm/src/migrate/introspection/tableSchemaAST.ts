import { storedType } from '../../schema/canonicalType.js';
import type { IndexFacet } from '../../schema/indexDifferences.js';
import { createTableNode, SchemaAST } from '../../schema/schemaAST.js';
import {
  type ColumnNode,
  DEFAULT_FOREIGN_KEY_ACTION,
  type RelationshipNode,
  type TableNode,
} from '../../schema/types.js';
import type { ColumnRenames, DialectName, TableSchema } from '../../type/index.js';
import { derivedForeignKeyName, qualifyName } from '../../util/sql.util.js';
import { renameIndexEntries } from '../schemaChange.js';

/** Where the tables were read: the engine, the one schema read, and what its catalogue reports about an index. */
export type ReadFrom = {
  readonly dialectName: DialectName;
  readonly schema?: string;
  readonly indexFacets: ReadonlySet<IndexFacet>;
};

/** The tables an introspector read, as a {@link SchemaAST}: every table first, so a foreign key reaches one read after it. */
export function tableSchemasToAST(schemas: readonly TableSchema[], from: ReadFrom): SchemaAST {
  const ast = new SchemaAST();
  const tables = schemas.map((schema) => ({ schema, table: tableNode(schema, from) }));
  const nodes = new Map(tables.map(({ schema, table }) => [schema.name, table]));
  for (const { table } of tables) {
    ast.addTable(table);
  }
  for (const { schema, table } of tables) {
    addRelationships(ast, nodes, schema, table);
    addIndexes(ast, schema, table);
  }
  return ast;
}

/** `table` with each column `renames` names under its new name, wherever the table names it. */
export function renamedTable(table: TableSchema, renames: ColumnRenames, schema?: string): TableSchema {
  const nameIn = (tableName: string) => (column: string) =>
    renames.get(qualifyName(tableName, schema))?.find((rename) => rename.from === column)?.to ?? column;
  const own = nameIn(table.name);
  return {
    ...table,
    columns: table.columns.map((column) => ({ ...column, name: own(column.name) })),
    primaryKey: table.primaryKey && { ...table.primaryKey, columns: table.primaryKey.columns.map(own) },
    indexes: table.indexes?.map((index) => ({ ...index, entries: renameIndexEntries(index.entries, own) })),
    foreignKeys: table.foreignKeys?.map((foreignKey) => ({
      ...foreignKey,
      columns: foreignKey.columns.map(own),
      references: {
        ...foreignKey.references,
        columns: foreignKey.references.columns.map(nameIn(foreignKey.references.table)),
      },
    })),
  };
}

function tableNode(schema: TableSchema, { dialectName, schema: namespace, indexFacets }: ReadFrom): TableNode {
  const table = createTableNode(schema.name, namespace, indexFacets);
  for (const col of schema.columns) {
    // Spread, not field by field: a `ColumnSchema` is a `ColumnNode` minus the graph links, so
    // everything but the type crosses unchanged and a field either shape gains cannot be dropped here.
    const { type, length: _length, precision: _precision, scale: _scale, ...rest } = col;
    const column: ColumnNode = { ...rest, type: storedType(dialectName, type, col), table };
    table.columns.set(col.name, column);
  }
  // The ordered key the query returned: `(a, b)` is a different key from `(b, a)`.
  table.primaryKey = schema.primaryKey;
  table.checks.push(...(schema.checks ?? []));
  table.triggers.push(...(schema.triggers ?? []));
  table.definition = schema.definition;
  return table;
}

function addRelationships(
  ast: SchemaAST,
  nodes: ReadonlyMap<string, TableNode>,
  schema: TableSchema,
  fromTable: TableNode,
): void {
  for (const fk of schema.foreignKeys ?? []) {
    const toTable = nodes.get(fk.references.table);
    if (!toTable) {
      fromTable.externalForeignKeys.push(fk);
      continue;
    }
    const fromColumns = fk.columns.flatMap((name) => fromTable.columns.get(name) ?? []);
    const toColumns = fk.references.columns.flatMap((name) => toTable.columns.get(name) ?? []);
    if (fromColumns.length > 0 && toColumns.length > 0) {
      const relationship: RelationshipNode = {
        name: fk.name ?? derivedForeignKeyName(schema.name, fk.columns),
        type: fromColumns[0].isUnique ? 'OneToOne' : 'ManyToOne',
        from: { table: fromTable, columns: fromColumns },
        to: { table: toTable, columns: toColumns },
        onDelete: fk.onDelete || DEFAULT_FOREIGN_KEY_ACTION,
        onUpdate: fk.onUpdate || DEFAULT_FOREIGN_KEY_ACTION,
      };
      ast.addRelationship(relationship);
    }
  }
}

/** An expression has no column to resolve; an entry naming a column the table lacks is dropped, as the entity side does. */
function addIndexes(ast: SchemaAST, schema: TableSchema, table: TableNode): void {
  for (const index of schema.indexes ?? []) {
    const entries = index.entries.filter((entry) => entry.expression || table.columns.has(entry.column));
    if (entries.length > 0) {
      ast.addIndex({ ...index, table, entries });
    }
  }
}
