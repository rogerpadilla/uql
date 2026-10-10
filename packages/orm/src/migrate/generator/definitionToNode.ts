import { createTableNode, keyOfColumns } from '../../schema/schemaAST.js';
import type { TableNode } from '../../schema/types.js';
import type { IndexColumnInput, IndexOptions } from '../../type/entity.js';
import type { ForeignKeySchema, IndexSchema } from '../../type/migration.js';
import type { QuerySql } from '../../type/querySql.js';
import {
  declaredIndexName,
  enumCheck,
  normalizeIndexColumn,
  renderIndexColumn,
} from '../../util/ddlExpression.util.js';
import { derivedIndexName, splitQualifiedName } from '../../util/sql.util.js';
import type { ColumnDefinition, FullColumnDefinition, IndexDefinition, TableDefinition } from '../builder/types.js';

/**
 * A migration builder's table definition as the AST nodes the generators render from, so a hand-written
 * `createTable` and an entity reach `generateCreateTableFromNode` in the same shape, its SQL rendered by
 * `render`. Free functions and not generator methods: the dialect reaches them only through `render`.
 */
export function tableDefinitionToNode(def: TableDefinition, render: (sql: QuerySql) => string): TableNode {
  const { name, schema } = splitQualifiedName(def.name);
  // Foreign keys stay external: each names its target table, which has no node in this build.
  const table: TableNode = {
    ...createTableNode(name, schema),
    comment: def.comment,
    externalForeignKeys: [...def.foreignKeys],
  };
  const { columns } = table;

  for (const colDef of def.columns) {
    columns.set(colDef.name, { ...bareColumn(colDef), table });
  }
  table.checks.push(...def.columns.flatMap((column) => enumCheck(name, column, render)));
  // A declared key keeps only the columns the table has, in its own order.
  table.primaryKey = def.primaryKey
    ? { columns: def.primaryKey.filter((name) => columns.has(name)) }
    : keyOfColumns(columns.values());

  for (const idxDef of def.indexes) {
    table.indexes.push({ ...renderIndexDefinition(name, idxDef, render), table });
  }

  return table;
}

/** A builder's column without its `index`, `foreignKey` and `enum`, which are lifted onto the table. */
export function bareColumn({
  index: _index,
  foreignKey: _foreignKey,
  enum: _enum,
  ...column
}: FullColumnDefinition): ColumnDefinition {
  return column;
}

/**
 * The index a column-level `index` or `unique` declares, or nothing: a unique column is a unique index.
 *
 * Shared with `TableDefinitionBuilder.build`, which lifts these into the table it is creating: written twice,
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

/**
 * The index that `table.index`, `table.unique` and `createIndex` record. Its entries are normalized, since
 * an entry left as written reaches the generator as a column named `[object Object]`. An unnamed index is
 * named when rendered, with `_uk` only for `table.unique`, so names earlier migrations installed stay.
 */
export function indexDefinition(
  columns: readonly IndexColumnInput[],
  { name, unique = false, ...options }: IndexOptions = {},
  uniqueName = false,
): IndexDefinition {
  return { ...options, name, entries: columns.map(normalizeIndexColumn), unique, uniqueName };
}

/**
 * An index the builder recorded, its SQL rendered by `render` into the text the schema holds, and named
 * from that text the way an entity's is.
 */
export function renderIndexDefinition(
  table: string,
  { uniqueName, ...index }: IndexDefinition,
  render: (sql: QuerySql) => string,
): IndexSchema {
  const where = index.where && render(index.where);
  return {
    ...index,
    name: declaredIndexName(index.name, table, index.entries, { unique: uniqueName, where }),
    where,
    entries: index.entries.map((entry) => renderIndexColumn(entry, render)),
  };
}

/** The foreign key a column-level `references` declares, or nothing. Shared for the same reason. */
export function columnForeignKey(col: FullColumnDefinition): ForeignKeySchema | undefined {
  if (!col.foreignKey) {
    return undefined;
  }
  return { ...col.foreignKey, columns: [col.name] };
}
