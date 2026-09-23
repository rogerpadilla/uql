import type { PrimaryKeySchema } from '../type/migration.js';
import { qualifyName } from '../util/sql.util.js';
import { createOrder, dropOrder } from './dependencyGraph.js';
import type { IndexFacet } from './indexDifferences.js';
import type { ColumnNode, IndexNode, RelationshipNode, TableNode } from './types.js';

/** A table node with its collections empty, ready to be filled. */
export function createTableNode(
  name: string,
  schema?: string,
  indexFacets: ReadonlySet<IndexFacet> = new Set(),
): TableNode {
  return {
    name,
    schema,
    indexFacets,
    columns: new Map(),
    indexes: [],
    checks: [],
    incomingRelations: [],
    outgoingRelations: [],
  };
}

/** The key the columns' own flags say, in their order, for a source that reports no key of its own. */
export function keyOfColumns(
  columns: Iterable<Pick<ColumnNode, 'name' | 'isPrimaryKey'>>,
): PrimaryKeySchema | undefined {
  const keyColumns = [...columns].filter((column) => column.isPrimaryKey).map((column) => column.name);
  return keyColumns.length ? { columns: keyColumns } : undefined;
}

/** A database schema as a graph: tables, the foreign keys between them, and their indexes. */
export class SchemaAST {
  readonly tables: Map<string, TableNode> = new Map();
  readonly relationships: RelationshipNode[] = [];
  readonly indexes: IndexNode[] = [];

  /** A table by the key it is stored under: schema-qualified where it has one (see `qualifyName`). */
  getTable(name: string): TableNode | undefined {
    return this.tables.get(name);
  }

  addTable(table: TableNode): void {
    this.tables.set(qualifyName(table.name, table.schema), table);
  }

  getTables(): TableNode[] {
    return [...this.tables.values()];
  }

  /** Tables in `CREATE` order, each after the tables it references. */
  getCreateOrder(): TableNode[] {
    return createOrder(this.tables.values(), referencedTables);
  }

  /** Tables in `DROP` order, each before the tables it references. */
  getDropOrder(): TableNode[] {
    return dropOrder(this.tables.values(), referencedTables);
  }

  addIndex(index: IndexNode): void {
    this.indexes.push(index);
    if (!index.table.indexes.includes(index)) {
      index.table.indexes.push(index);
    }
  }

  /** Adds a foreign key, linking it from both tables and both column sets. */
  addRelationship(rel: RelationshipNode): void {
    this.relationships.push(rel);
    rel.from.table.outgoingRelations.push(rel);
    rel.to.table.incomingRelations.push(rel);
    for (const col of rel.from.columns) {
      col.references = rel;
    }
    for (const col of rel.to.columns) {
      col.referencedBy.push(rel);
    }
  }
}

function referencedTables(table: TableNode): TableNode[] {
  return table.outgoingRelations.map((rel) => rel.to.table);
}
