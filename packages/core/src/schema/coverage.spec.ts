import { describe, expect, it } from 'vitest';
import { canonicalToColumnType, canonicalToSql, sqlToCanonical } from './canonicalType.js';
import { SchemaAST } from './schemaAST.js';
import { SchemaASTBuilder } from './schemaASTBuilder.js';
import { SchemaASTDiffer } from './schemaASTDiffer.js';
import type { ColumnNode, IndexNode, RelationshipNode, TableNode } from './types.js';

describe('Schema Coverage', () => {
  it('canonicalType covers unknown types and dialects', () => {
    // Unknown type
    expect(sqlToCanonical('unknown_type')).toEqual({ category: 'string', raw: 'unknown_type' });

    // Cover default in formatStringSqlType using a dialect not explicitly handled in if/else
    expect(canonicalToSql({ category: 'string' }, 'mongodb')).toBe('VARCHAR(255)');
    expect(canonicalToSql({ category: 'string', length: 100 }, 'mongodb')).toBe('VARCHAR(100)');

    // Default in formatDecimalSqlType
    expect(canonicalToSql({ category: 'decimal' }, 'postgres')).toBe('NUMERIC');

    // Default in canonicalToColumnType
    expect(canonicalToColumnType({ category: 'string' })).toBe('text');
    expect(canonicalToColumnType({ category: 'string', length: 100 })).toBe('varchar');
  });

  it('SchemaAST covers table removal and circular dependencies', () => {
    const ast = new SchemaAST();
    const t1 = createTableNode('t1', ast).table;
    const t2 = createTableNode('t2', ast).table;

    ast.addTable(t1);
    ast.addTable(t2);
    expect(ast.getTables()).toHaveLength(2);

    ast.removeTable('t1');
    expect(ast.getTables()).toHaveLength(1);
    expect(ast.getTable('t1')).toBeUndefined();

    // Circular dependencies
    ast.addTable(t1);
    ast.addRelationship({
      name: 'r1',
      type: 'ManyToOne',
      from: { table: t1, columns: [] },
      to: { table: t2, columns: [] },
    });
    ast.addRelationship({
      name: 'r2',
      type: 'ManyToOne',
      from: { table: t2, columns: [] },
      to: { table: t1, columns: [] },
    });

    expect(ast.hasCircularDependencies()).toBe(true);
    expect(ast.detectCircularDependencies()).toHaveLength(1);

    // Junction table detection helper
    const addFakeRel = (from: TableNode, to: TableNode) => {
      const rel: RelationshipNode = {
        name: `fk_${from.name}_${to.name}`,
        type: 'ManyToOne',
        from: { table: from, columns: [] },
        to: { table: to, columns: [] },
      };
      from.outgoingRelations.push(rel);
    };

    const junction = createTableNode('user_roles', ast, 2).table;
    ast.addTable(junction);
    addFakeRel(junction, t1);
    addFakeRel(junction, t2);
    expect(ast.isJunctionTable(junction)).toBe(true);

    // Cover containsBothNames branch in isJunctionTable
    const junction2 = createTableNode('t1_t2', ast, 3).table;
    ast.addTable(junction2);
    addFakeRel(junction2, t1);
    addFakeRel(junction2, t2);
    expect(ast.isJunctionTable(junction2)).toBe(true);

    // Inverse relations
    expect(ast.getInverseRelationType('OneToOne')).toBe('OneToOne');
    expect(ast.getInverseRelationType('OneToMany')).toBe('ManyToOne');
    expect(ast.getInverseRelationType('ManyToOne')).toBe('OneToMany');
    expect(ast.getInverseRelationType('ManyToMany')).toBe('ManyToMany');
  });

  it('SchemaAST covers clone and statistics', () => {
    const ast = new SchemaAST();
    const { table: t1, columns: cols } = createTableNode('t1', ast);
    const c1 = cols[0];
    ast.addTable(t1);

    const idx: IndexNode = { name: 'i1', table: t1, columns: [c1], unique: false };
    ast.addIndex(idx);

    const cloned = ast.clone();
    expect(cloned.getTable('t1')).toBeDefined();
    expect(cloned.getTable('t1')).not.toBe(t1);
    expect(cloned.getTableIndexes('t1')).toHaveLength(1);

    expect(ast.getStats().tableCount).toBe(1);
    expect(ast.toJSON()).toBeDefined();

    // Cover getReferencedColumn
    expect(ast.getReferencedColumn(c1)).toBeUndefined();
  });

  it('SchemaASTBuilder covers full paths', () => {
    const builder = new SchemaASTBuilder();
    const ast = builder.fromEntities([], { resolveTableName: () => 'custom' });
    expect(builder.getAST()).toBe(ast);
  });

  it('SchemaASTDiffer covers more edge cases', () => {
    const ast1 = new SchemaAST();
    const ast2 = new SchemaAST();

    const { table: t1 } = createTableNode('t1', ast1);
    const { table: t2 } = createTableNode('t1', ast2, 1, { nullable: false });

    ast1.addTable(t1);
    ast2.addTable(t2);

    const differ = new SchemaASTDiffer();
    const result = differ.diff(ast1, ast2);

    expect(result.hasDifferences).toBe(true);
    expect(result.tablesToAlter).toHaveLength(1);
    expect(result.columnDiffs).toHaveLength(1);
    expect(result.columnDiffs[0].type).toBe('alter');
  });

  it('SchemaAST covers inferRelationType', () => {
    const ast = new SchemaAST();
    // Unique FK -> OneToOne
    const { table: t1, columns: cols1 } = createTableNode('t1', ast, 1, { isUnique: true });
    const c1 = cols1[0];
    expect(
      ast.inferRelationType({
        name: 'r',
        type: 'ManyToOne',
        from: { table: t1, columns: [c1] },
        to: { table: t1, columns: [] },
      }),
    ).toBe('OneToOne');

    // Non-unique -> ManyToOne
    const { table: t2, columns: cols2 } = createTableNode('t2', ast, 1, { isUnique: false });
    const c2 = cols2[0];
    expect(
      ast.inferRelationType({
        name: 'r',
        type: 'ManyToOne',
        from: { table: t2, columns: [c2] },
        to: { table: t2, columns: [] },
      }),
    ).toBe('ManyToOne');
  });
});

/**
 * Helper to create a TableNode without repeating boilerplate.
 */
function createTableNode(
  name: string,
  ast: SchemaAST,
  columnCount = 1,
  colOverrides?: Partial<ColumnNode>,
): { table: TableNode; columns: ColumnNode[] } {
  const columns = new Map<string, ColumnNode>();
  const table: TableNode = {
    name,
    columns,
    primaryKey: [],
    indexes: [],
    schema: ast,
    incomingRelations: [],
    outgoingRelations: [],
  };

  const columnList: ColumnNode[] = [];
  for (let i = 0; i < columnCount; i++) {
    const colName = `col${i}`;
    const column: ColumnNode = {
      name: colName,
      type: { category: 'string' },
      nullable: true,
      isPrimaryKey: false,
      isAutoIncrement: false,
      isUnique: false,
      table,
      referencedBy: [],
      ...colOverrides,
    };
    columns.set(colName, column);
    columnList.push(column);
  }

  return { table, columns: columnList };
}
