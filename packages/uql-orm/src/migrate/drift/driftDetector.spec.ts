import { describe, expect, it } from 'vitest';
import { MySqlDialect } from '../../dialect/index.js';
import { SchemaAST } from '../../schema/schemaAST.js';
import { mockTableNode } from '../../test/index.js';
import { detectDrift } from './driftDetector.js';

describe('DriftDetector', () => {
  describe('detect', () => {
    it('should leave excluded tables out of the comparison', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();
      expected.addTable(mockTableNode('users', [{ name: 'id', isPrimaryKey: true }]));
      actual.addTable(mockTableNode('users', [{ name: 'id', isPrimaryKey: true }]));
      // Present in the database by design, with no entity behind it.
      actual.addTable(mockTableNode('uql_migrations', [{ name: 'name', isPrimaryKey: true }]));

      const report = detectDrift(expected, actual, {
        dialect: new MySqlDialect(),
        excludeTables: ['uql_migrations'],
      });

      expect(report.status).toBe('in_sync');
      expect(report.drifts).toEqual([]);
    });

    it('should report a default mismatch only when asked to', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();
      expected.addTable(mockTableNode('users', [{ name: 'status', defaultValue: 'active' }]));
      actual.addTable(mockTableNode('users', [{ name: 'status', defaultValue: 'pending' }]));

      const options = { dialect: new MySqlDialect() };
      expect(detectDrift(expected, actual, options).drifts).toEqual([]);

      const drifts = detectDrift(expected, actual, { ...options, checkDefaults: true }).drifts;
      expect(drifts).toHaveLength(1);
      expect(drifts[0].details).toContain('Default mismatch');
    });

    it('should detect type mismatches', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      const table1 = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'age', type: { category: 'integer' } },
      ]);
      const table2 = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'age', type: { category: 'string' } },
      ]);

      expected.addTable(table1);
      actual.addTable(table2);

      const report = detectDrift(expected, actual, { dialect: new MySqlDialect() });

      expect(report.status).toBe('critical');
      expect(report.drifts.some((d) => d.type === 'type_mismatch')).toBe(true);
    });

    it('should detect breaking type mismatches as critical', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      // Reducing length in code (expected) compared to DB (actual) is not breaking.
      // Reducing length in DB (actual) compared to code (expected) IS breaking.
      const table1 = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'bio', type: { category: 'string', length: 100 } },
      ]);
      const table2 = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'bio', type: { category: 'string', length: 1000 } },
      ]);

      expected.addTable(table1);
      actual.addTable(table2);

      const report = detectDrift(expected, actual, { dialect: new MySqlDialect() });

      expect(report.status).toBe('critical');
      expect(report.drifts.some((d) => d.type === 'type_mismatch' && d.severity === 'critical')).toBe(true);
    });

    it('should detect nullable mismatches', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      const table1 = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' }, nullable: false },
      ]);
      const table2 = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' }, nullable: true },
      ]);

      expected.addTable(table1);
      actual.addTable(table2);

      const report = detectDrift(expected, actual, { dialect: new MySqlDialect() });

      expect(report.drifts.some((d) => d.type === 'constraint_mismatch')).toBe(true);
    });

    /** Widening a column loses no data, so it needs a migration but not an alarm. */
    it('should report a non-breaking type change as a warning', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      expected.addTable(
        mockTableNode('users', [
          { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
          { name: 'bio', type: { category: 'string', length: 1000 } },
        ]),
      );
      actual.addTable(
        mockTableNode('users', [
          { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
          { name: 'bio', type: { category: 'string', length: 100 } },
        ]),
      );

      const report = detectDrift(expected, actual, { dialect: new MySqlDialect() });
      const drift = report.drifts.find((d) => d.type === 'type_mismatch');

      expect(drift).toMatchObject({
        severity: 'warning',
        expected: 'VARCHAR(1000)',
        actual: 'VARCHAR(100)',
        suggestion: 'Create migration to align types',
      });
      expect(report.status).toBe('drifted');
    });

    it('should spell out both sides of a nullable mismatch', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      expected.addTable(
        mockTableNode('users', [
          { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
          { name: 'email', type: { category: 'string' }, nullable: true },
        ]),
      );
      actual.addTable(
        mockTableNode('users', [
          { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
          { name: 'email', type: { category: 'string' }, nullable: false },
        ]),
      );

      const report = detectDrift(expected, actual, { dialect: new MySqlDialect() });

      expect(report.drifts.find((d) => d.type === 'constraint_mismatch')).toMatchObject({
        expected: 'NULLABLE',
        actual: 'NOT NULL',
      });
    });

    it('should detect missing indexes', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      const table1 = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);
      const table2 = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);

      expected.addTable(table1);
      actual.addTable(table2);

      expected.addIndex({
        name: 'idx_email',
        table: table1,
        entries: [{ column: 'email' }],
        unique: true,
      });

      const report = detectDrift(expected, actual, { checkIndexes: true });

      expect(report.drifts.some((d) => d.type === 'missing_index')).toBe(true);
    });

    it('should detect an index that no longer covers the columns the entity declares', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      const table1 = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);
      const table2 = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);

      expected.addTable(table1);
      actual.addTable(table2);

      expected.addIndex({
        name: 'idx_email',
        table: table1,
        entries: [{ column: 'email' }],
        unique: true,
      });
      // The same name over the same column, but the database's is not unique.
      actual.addIndex({
        name: 'idx_email',
        table: table2,
        entries: [{ column: 'email' }],
        unique: false,
      });

      const report = detectDrift(expected, actual, { checkIndexes: true });

      const drift = report.drifts.find((d) => d.type === 'index_mismatch');
      expect(drift?.index).toBe('idx_email');
      expect(drift?.details).toContain('unique');
    });

    it('should detect missing relationships', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      const users = mockTableNode('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const posts = mockTableNode('posts', [
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
        from: { table: posts, columns: [posts.columns.get('author_id')!] },
        to: { table: users, columns: [users.columns.get('id')!] },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });

      const report = detectDrift(expected, actual, { checkForeignKeys: true });

      expect(report.drifts.some((d) => d.type === 'missing_relationship')).toBe(true);
    });

    it('should detect unexpected columns', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      const table1 = mockTableNode('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const table2 = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'extra', type: { category: 'string' } },
      ]);

      expected.addTable(table1);
      actual.addTable(table2);

      const report = detectDrift(expected, actual, { dialect: new MySqlDialect() });

      expect(report.drifts.some((d) => d.type === 'unexpected_column')).toBe(true);
    });

    it('should detect unexpected indexes', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      const table1 = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);
      const table2 = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);

      expected.addTable(table1);
      actual.addTable(table2);

      actual.addIndex({
        name: 'idx_email',
        table: table2,
        entries: [{ column: 'email' }],
        unique: true,
      });

      const report = detectDrift(expected, actual, { checkIndexes: true });

      expect(report.drifts.some((d) => d.type === 'unexpected_index')).toBe(true);
    });

    it('should detect unexpected relationships', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      const users = mockTableNode('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const posts = mockTableNode('posts', [
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
        from: { table: posts, columns: [posts.columns.get('author_id')!] },
        to: { table: users, columns: [users.columns.get('id')!] },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });

      const report = detectDrift(expected, actual, { checkForeignKeys: true });

      expect(report.drifts.some((d) => d.type === 'unexpected_relationship')).toBe(true);
    });

    it('should respect checkOptions', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      const table1 = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'age', type: { category: 'integer' } },
      ]);
      const table2 = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'age', type: { category: 'string' } },
      ]);

      expected.addTable(table1);
      actual.addTable(table2);

      const report = detectDrift(expected, actual, { checkTypes: false });

      expect(report.status).toBe('in_sync');
    });

    it('should format type with precision and scale', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      const table1 = mockTableNode('test', [
        { name: 'id', isPrimaryKey: true },
        { name: 'price', type: { category: 'decimal', precision: 10, scale: 2 } },
      ]);
      const table2 = mockTableNode('test', [
        { name: 'id', isPrimaryKey: true },
        { name: 'price', type: { category: 'decimal', precision: 12, scale: 4 } },
      ]);

      expected.addTable(table1);
      actual.addTable(table2);

      const report = detectDrift(expected, actual, { dialect: new MySqlDialect() });

      expect(report.drifts[0].expected).toBe('DECIMAL(10, 2)');
      expect(report.drifts[0].actual).toBe('DECIMAL(12, 4)');
    });

    it('should detect missing/unexpected tables', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      expected.addTable(mockTableNode('table1', [{ name: 'id', isPrimaryKey: true }]));
      actual.addTable(mockTableNode('table2', [{ name: 'id', isPrimaryKey: true }]));

      const report = detectDrift(expected, actual);
      expect(report.drifts.some((d) => d.type === 'missing_table')).toBe(true);
      expect(report.drifts.some((d) => d.type === 'unexpected_table')).toBe(true);
    });

    it('should detect missing columns', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      expected.addTable(
        mockTableNode('users', [
          { name: 'id', isPrimaryKey: true },
          { name: 'missing', type: { category: 'string' } },
        ]),
      );
      actual.addTable(mockTableNode('users', [{ name: 'id', isPrimaryKey: true }]));

      const report = detectDrift(expected, actual);
      expect(report.drifts.some((d) => d.type === 'missing_column')).toBe(true);
    });

    it('should report two empty schemas as in sync', () => {
      const report = detectDrift(new SchemaAST(), new SchemaAST());

      expect(report.status).toBe('in_sync');
      expect(report.drifts).toEqual([]);
    });

    it('should detect unexpected columns', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();
      expected.addTable(mockTableNode('users', [{ name: 'id', isPrimaryKey: true }]));
      actual.addTable(
        mockTableNode('users', [
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
      const t1 = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }]);
      expected.addTable(t1);
      expected.addIndex({ name: 'idx_1', table: t1, entries: [], unique: false });

      const t2 = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }]);
      actual.addTable(t2);
      actual.addIndex({ name: 'idx_2', table: t2, entries: [], unique: false });

      const report = detectDrift(expected, actual);
      expect(report.drifts.some((d) => d.type === 'missing_index')).toBe(true);
      expect(report.drifts.some((d) => d.type === 'unexpected_index')).toBe(true);
    });

    it('should detect missing/unexpected relationships', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();
      const t1 = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }, { name: 'role_id' }]);
      expected.addTable(t1);
      expected.addRelationship({
        name: 'fk_1',
        type: 'ManyToOne',
        from: { table: t1, columns: [t1.columns.get('role_id')!] },
        to: { table: t1, columns: [t1.columns.get('id')!] },
      });

      const t2 = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }, { name: 'dept_id' }]);
      actual.addTable(t2);
      actual.addRelationship({
        name: 'fk_2',
        type: 'ManyToOne',
        from: { table: t2, columns: [t2.columns.get('dept_id')!] },
        to: { table: t2, columns: [t2.columns.get('id')!] },
      });

      const report = detectDrift(expected, actual);
      expect(report.drifts.some((d) => d.type === 'missing_relationship')).toBe(true);
      expect(report.drifts.some((d) => d.type === 'unexpected_relationship')).toBe(true);
    });

    it('should respect checkIndexes: false', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();
      const t1 = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }]);
      expected.addTable(t1);
      expected.addIndex({ name: 'idx_1', table: t1, entries: [], unique: false });

      actual.addTable(mockTableNode('users', [{ name: 'id', isPrimaryKey: true }]));

      const report = detectDrift(expected, actual, { checkIndexes: false });
      expect(report.drifts.some((d) => d.type === 'missing_index')).toBe(false);
    });

    it('should respect checkForeignKeys: false', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();
      const t1 = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }, { name: 'role_id' }]);
      expected.addTable(t1);
      expected.addRelationship({
        name: 'fk_1',
        type: 'ManyToOne',
        from: { table: t1, columns: [t1.columns.get('role_id')!] },
        to: { table: t1, columns: [t1.columns.get('id')!] },
      });

      actual.addTable(mockTableNode('users', [{ name: 'id', isPrimaryKey: true }, { name: 'role_id' }]));

      const report = detectDrift(expected, actual, { checkForeignKeys: false });
      expect(report.drifts.some((d) => d.type === 'missing_relationship')).toBe(false);
    });

    it('should respect checkNullable: false', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      expected.addTable(
        mockTableNode('users', [
          { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
          { name: 'email', type: { category: 'string' }, nullable: false },
        ]),
      );
      actual.addTable(
        mockTableNode('users', [
          { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
          { name: 'email', type: { category: 'string' }, nullable: true },
        ]),
      );

      const report = detectDrift(expected, actual, { checkNullable: false, checkTypes: false });
      expect(report.drifts.some((d) => d.type === 'constraint_mismatch')).toBe(false);
      expect(report.status).toBe('in_sync');
    });

    it('should return drifted status for non-critical drifts', () => {
      const expected = new SchemaAST();
      const actual = new SchemaAST();

      const t1 = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }]);
      expected.addTable(t1);
      const t2 = mockTableNode('users', [
        { name: 'id', isPrimaryKey: true },
        { name: 'extra', type: { category: 'string' } },
      ]);
      actual.addTable(t2);

      // No type check, no nullable check - only warning-level unexpected column
      const report = detectDrift(expected, actual, { checkTypes: false });
      expect(report.status).toBe('drifted');
      expect(report.summary.warning).toBeGreaterThan(0);
    });
  });
});
