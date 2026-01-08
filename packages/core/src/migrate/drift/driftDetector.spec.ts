import { describe, expect, it } from 'vitest';
import { SchemaAST } from '../../schema/schemaAST.js';
import type { ColumnNode, TableNode } from '../../schema/types.js';
import { createDriftDetector, DriftDetector, detectDrift } from './driftDetector.js';

function createTable(name: string, columns: Partial<ColumnNode>[]): TableNode {
  const table: TableNode = {
    name,
    columns: new Map(),
    primaryKey: [],
    indexes: [],
    incomingRelations: [],
    outgoingRelations: [],
    schema: undefined as unknown as SchemaAST,
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

describe('DriftDetector', () => {
  describe('detect', () => {
    it('should detect type mismatches', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      const table1 = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'age', type: { category: 'integer' } },
      ]);
      const table2 = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'age', type: { category: 'string' } },
      ]);

      expected.addTable(table1);
      actual.addTable(table2);

      const detector = new DriftDetector(expected, actual, { dialect: 'mysql' });
      const report = detector.detect();

      expect(report.status).toBe('critical');
      expect(report.drifts.some((d) => d.type === 'type_mismatch')).toBe(true);
    });

    it('should detect breaking type mismatches as critical', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      // Reducing length in code (expected) compared to DB (actual) is not breaking.
      // Reducing length in DB (actual) compared to code (expected) IS breaking.
      const table1 = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'bio', type: { category: 'string', length: 100 } },
      ]);
      const table2 = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'bio', type: { category: 'string', length: 1000 } },
      ]);

      expected.addTable(table1);
      actual.addTable(table2);

      const detector = new DriftDetector(expected, actual, { dialect: 'mysql' });
      const report = detector.detect();

      expect(report.status).toBe('critical');
      expect(report.drifts.some((d) => d.type === 'type_mismatch' && d.severity === 'critical')).toBe(true);
    });

    it('should detect nullable mismatches', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      const table1 = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' }, nullable: false },
      ]);
      const table2 = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' }, nullable: true },
      ]);

      expected.addTable(table1);
      actual.addTable(table2);

      const detector = new DriftDetector(expected, actual, { dialect: 'mysql' });
      const report = detector.detect();

      expect(report.drifts.some((d) => d.type === 'constraint_mismatch')).toBe(true);
    });

    it('should detect missing indexes', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      const table1 = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);
      const table2 = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);

      expected.addTable(table1);
      actual.addTable(table2);

      expected.addIndex({
        name: 'idx_email',
        table: table1,
        columns: [table1.columns.get('email')],
        unique: true,
      });

      const detector = new DriftDetector(expected, actual, { checkIndexes: true });
      const report = detector.detect();

      expect(report.drifts.some((d) => d.type === 'missing_index')).toBe(true);
    });

    it('should detect missing relationships', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      const users = createTable('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const posts = createTable('posts', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'author_id', type: { category: 'integer' } },
      ]);

      expected.addTable(users);
      expected.addTable(posts);
      actual.addTable(users);
      actual.addTable(posts);

      expected.addRelationship({
        name: 'fk_posts_users',
        type: 'ManyToOne',
        from: { table: posts, columns: [posts.columns.get('author_id')] },
        to: { table: users, columns: [users.columns.get('id')] },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });

      const detector = new DriftDetector(expected, actual, { checkForeignKeys: true });
      const report = detector.detect();

      expect(report.drifts.some((d) => d.type === 'missing_relationship')).toBe(true);
    });

    it('should detect unexpected columns', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      const table1 = createTable('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const table2 = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'extra', type: { category: 'string' } },
      ]);

      expected.addTable(table1);
      actual.addTable(table2);

      const detector = new DriftDetector(expected, actual, { dialect: 'mysql' });
      const report = detector.detect();

      expect(report.drifts.some((d) => d.type === 'unexpected_column')).toBe(true);
    });

    it('should detect unexpected indexes', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      const table1 = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);
      const table2 = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);

      expected.addTable(table1);
      actual.addTable(table2);

      actual.addIndex({
        name: 'idx_email',
        table: table2,
        columns: [table2.columns.get('email')],
        unique: true,
      });

      const detector = new DriftDetector(expected, actual, { checkIndexes: true });
      const report = detector.detect();

      expect(report.drifts.some((d) => d.type === 'unexpected_index')).toBe(true);
    });

    it('should detect unexpected relationships', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      const users = createTable('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const posts = createTable('posts', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'author_id', type: { category: 'integer' } },
      ]);

      expected.addTable(users);
      expected.addTable(posts);
      actual.addTable(users);
      actual.addTable(posts);

      actual.addRelationship({
        name: 'fk_posts_users',
        type: 'ManyToOne',
        from: { table: posts, columns: [posts.columns.get('author_id')] },
        to: { table: users, columns: [users.columns.get('id')] },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });

      const detector = new DriftDetector(expected, actual, { checkForeignKeys: true });
      const report = detector.detect();

      expect(report.drifts.some((d) => d.type === 'unexpected_relationship')).toBe(true);
    });

    it('should respect checkOptions', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      const table1 = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'age', type: { category: 'integer' } },
      ]);
      const table2 = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'age', type: { category: 'string' } },
      ]);

      expected.addTable(table1);
      actual.addTable(table2);

      const detector = new DriftDetector(expected, actual, { checkTypes: false });
      const report = detector.detect();

      expect(report.status).toBe('in_sync');
    });

    it('should format type with precision and scale', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      const table1 = createTable('test', [
        { name: 'id', isPrimaryKey: true },
        { name: 'price', type: { category: 'decimal', precision: 10, scale: 2 } },
      ]);
      const table2 = createTable('test', [
        { name: 'id', isPrimaryKey: true },
        { name: 'price', type: { category: 'decimal', precision: 12, scale: 4 } },
      ]);

      expected.addTable(table1);
      actual.addTable(table2);

      const detector = new DriftDetector(expected, actual, { dialect: 'mysql' });
      const report = detector.detect();

      expect(report.drifts[0].expected).toBe('DECIMAL(10, 2)');
      expect(report.drifts[0].actual).toBe('DECIMAL(12, 4)');
    });

    it('should detect missing/unexpected tables', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      expected.addTable(createTable('table1', [{ name: 'id', isPrimaryKey: true }]));
      actual.addTable(createTable('table2', [{ name: 'id', isPrimaryKey: true }]));

      const report = detectDrift(expected, actual);
      expect(report.drifts.some((d) => d.type === 'missing_table')).toBe(true);
      expect(report.drifts.some((d) => d.type === 'unexpected_table')).toBe(true);
    });

    it('should detect missing columns', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      expected.addTable(
        createTable('users', [
          { name: 'id', isPrimaryKey: true },
          { name: 'missing', type: { category: 'string' } },
        ]),
      );
      actual.addTable(createTable('users', [{ name: 'id', isPrimaryKey: true }]));

      const report = detectDrift(expected, actual);
      expect(report.drifts.some((d) => d.type === 'missing_column')).toBe(true);
    });

    it('should use convenience functions', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      const detector = createDriftDetector(expected, actual);
      expect(detector).toBeInstanceOf(DriftDetector);

      const report = detectDrift(expected, actual);
      expect(report.status).toBe('in_sync');
    });

    it('should detect unexpected columns', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();
      expected.addTable(createTable('users', [{ name: 'id', isPrimaryKey: true }]));
      actual.addTable(
        createTable('users', [
          { name: 'id', isPrimaryKey: true },
          { name: 'extra', type: { category: 'string' } },
        ]),
      );

      const report = detectDrift(expected, actual);
      expect(report.drifts.some((d) => d.type === 'unexpected_column')).toBe(true);
    });

    it('should detect missing/unexpected indexes', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();
      const t1 = createTable('users', [{ name: 'id', isPrimaryKey: true }]);
      expected.addTable(t1);
      expected.addIndex({ name: 'idx_1', table: t1, columns: [], unique: false } as any);

      const t2 = createTable('users', [{ name: 'id', isPrimaryKey: true }]);
      actual.addTable(t2);
      actual.addIndex({ name: 'idx_2', table: t2, columns: [], unique: false } as any);

      const report = detectDrift(expected, actual);
      expect(report.drifts.some((d) => d.type === 'missing_index')).toBe(true);
      expect(report.drifts.some((d) => d.type === 'unexpected_index')).toBe(true);
    });

    it('should detect missing/unexpected relationships', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();
      const t1 = createTable('users', [{ name: 'id', isPrimaryKey: true }, { name: 'role_id' }]);
      expected.addTable(t1);
      expected.addRelationship({
        name: 'fk_1',
        from: { table: t1, columns: [t1.columns.get('role_id')] },
        to: { table: t1, columns: [t1.columns.get('id')] },
      } as any);

      const t2 = createTable('users', [{ name: 'id', isPrimaryKey: true }, { name: 'dept_id' }]);
      actual.addTable(t2);
      actual.addRelationship({
        name: 'fk_2',
        from: { table: t2, columns: [t2.columns.get('dept_id')] },
        to: { table: t2, columns: [t2.columns.get('id')] },
      } as any);

      const report = detectDrift(expected, actual);
      expect(report.drifts.some((d) => d.type === 'missing_relationship')).toBe(true);
      expect(report.drifts.some((d) => d.type === 'unexpected_relationship')).toBe(true);
    });

    it('should respect checkIndexes: false', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();
      const t1 = createTable('users', [{ name: 'id', isPrimaryKey: true }]);
      expected.addTable(t1);
      expected.addIndex({ name: 'idx_1', table: t1, columns: [], unique: false } as any);

      actual.addTable(createTable('users', [{ name: 'id', isPrimaryKey: true }]));

      const report = detectDrift(expected, actual, { checkIndexes: false });
      expect(report.drifts.some((d) => d.type === 'missing_index')).toBe(false);
    });
  });
});
