import { sqlToCanonical } from '../schema/canonicalType.js';
import type { IndexFacet } from '../schema/indexDifferences.js';
import { createTableNode, keyOfColumns } from '../schema/schemaAST.js';
import type { ColumnNode, TableNode } from '../schema/types.js';
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
