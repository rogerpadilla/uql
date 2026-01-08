import { describe, expect, it } from 'vitest';
import { SchemaAST } from './schemaAST.js';
import { diffSchemas, SchemaASTDiffer } from './schemaASTDiffer.js';
import type { ColumnNode, TableNode } from './types.js';

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

describe('SchemaASTDiffer', () => {
  describe('diff', () => {
    it('should detect no differences for identical schemas', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const table1 = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'name', type: { category: 'string' } },
      ]);
      const table2 = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'name', type: { category: 'string' } },
      ]);

      source.addTable(table1);
      target.addTable(table2);

      const differ = new SchemaASTDiffer();
      const diff = differ.diff(source, target);

      expect(diff.hasDifferences).toBe(false);
      expect(diff.tablesToCreate.length).toBe(0);
      expect(diff.tablesToDrop.length).toBe(0);
    });

    it('should detect tables to create', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const table = createTable('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      source.addTable(table);

      const differ = new SchemaASTDiffer();
      const diff = differ.diff(source, target);

      expect(diff.hasDifferences).toBe(true);
      expect(diff.tablesToCreate.length).toBe(1);
      expect(diff.tablesToCreate[0].name).toBe('users');
    });

    it('should detect tables to drop', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const table = createTable('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      target.addTable(table);

      const differ = new SchemaASTDiffer();
      const diff = differ.diff(source, target);

      expect(diff.hasDifferences).toBe(true);
      expect(diff.tablesToDrop.length).toBe(1);
      expect(diff.tablesToDrop[0].name).toBe('users');
    });

    it('should detect columns to add', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const sourceTable = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'name', type: { category: 'string' } },
        { name: 'email', type: { category: 'string' } },
      ]);
      const targetTable = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'name', type: { category: 'string' } },
      ]);

      source.addTable(sourceTable);
      target.addTable(targetTable);

      const differ = new SchemaASTDiffer();
      const diff = differ.diff(source, target);

      expect(diff.hasDifferences).toBe(true);
      expect(diff.columnDiffs.some((c) => c.column === 'email' && c.type === 'add')).toBe(true);
    });

    it('should detect columns to drop', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const sourceTable = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'name', type: { category: 'string' } },
      ]);
      const targetTable = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'name', type: { category: 'string' } },
        { name: 'email', type: { category: 'string' } },
      ]);

      source.addTable(sourceTable);
      target.addTable(targetTable);

      const differ = new SchemaASTDiffer();
      const diff = differ.diff(source, target);

      expect(diff.hasDifferences).toBe(true);
      expect(diff.columnDiffs.some((c) => c.column === 'email' && c.type === 'drop')).toBe(true);
    });

    it('should detect column type changes', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const sourceTable = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'age', type: { category: 'integer' } },
      ]);
      const targetTable = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'age', type: { category: 'string' } },
      ]);

      source.addTable(sourceTable);
      target.addTable(targetTable);

      const differ = new SchemaASTDiffer();
      const diff = differ.diff(source, target);

      expect(diff.hasDifferences).toBe(true);
      expect(diff.columnDiffs.some((c) => c.column === 'age' && c.type === 'alter')).toBe(true);
    });

    it('should detect nullable changes', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const sourceTable = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' }, nullable: false },
      ]);
      const targetTable = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' }, nullable: true },
      ]);

      source.addTable(sourceTable);
      target.addTable(targetTable);

      const differ = new SchemaASTDiffer();
      const diff = differ.diff(source, target);

      expect(diff.hasDifferences).toBe(true);
    });

    it('should detect auto-increment change', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();
      source.addTable(createTable('users', [{ name: 'id', isPrimaryKey: true, isAutoIncrement: true }]));
      target.addTable(createTable('users', [{ name: 'id', isPrimaryKey: true, isAutoIncrement: false }]));
      const result = new SchemaASTDiffer().diff(source, target);
      expect(result.columnDiffs[0].description).toContain('autoIncrement: false → true');
    });

    it('should detect default value changes', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();
      source.addTable(
        createTable('users', [
          { name: 'id', isPrimaryKey: true },
          { name: 'age', defaultValue: 30 },
        ]),
      );
      target.addTable(
        createTable('users', [
          { name: 'id', isPrimaryKey: true },
          { name: 'age', defaultValue: 20 },
        ]),
      );
      const result = new SchemaASTDiffer().diff(source, target);
      expect(result.columnDiffs[0].description).toContain('default: 20 → 30');
    });

    it('should detect unique constraint changes', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();
      source.addTable(
        createTable('users', [
          { name: 'id', isPrimaryKey: true },
          { name: 'email', isUnique: true },
        ]),
      );
      target.addTable(
        createTable('users', [
          { name: 'id', isPrimaryKey: true },
          { name: 'email', isUnique: false },
        ]),
      );
      const result = new SchemaASTDiffer().diff(source, target);
      expect(result.columnDiffs[0].description).toContain('unique: false → true');
    });

    it('should use case-insensitive comparison when configured', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const sourceTable = createTable('Users', [{ name: 'ID', type: { category: 'integer' }, isPrimaryKey: true }]);
      const targetTable = createTable('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);

      source.addTable(sourceTable);
      target.addTable(targetTable);

      const differ = new SchemaASTDiffer();
      const diff = differ.diff(source, target, { ignoreCase: true });

      // With case insensitive, tables should match
      expect(diff.tablesToCreate.length).toBe(0);
      expect(diff.tablesToDrop.length).toBe(0);
    });

    it('should detect breaking changes', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const sourceTable = createTable('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const targetTable = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);

      source.addTable(sourceTable);
      target.addTable(targetTable);

      const differ = new SchemaASTDiffer();
      const diff = differ.diff(source, target);

      expect(diff.hasBreakingChanges).toBe(true);
    });

    it('should format meaningful type differences (size, precision, scale, unsigned)', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const sourceTable = createTable('users', [
        { name: 'id', isPrimaryKey: true },
        { name: 'amount', type: { category: 'decimal', precision: 10, scale: 2, unsigned: true } },
        { name: 'bio', type: { category: 'string', length: 255 } },
      ]);
      const targetTable = createTable('users', [
        { name: 'id', isPrimaryKey: true },
        { name: 'amount', type: { category: 'decimal', precision: 8, scale: 2 } },
        { name: 'bio', type: { category: 'string', length: 100 } },
      ]);

      source.addTable(sourceTable);
      target.addTable(targetTable);

      const differ = new SchemaASTDiffer();
      const diff = differ.diff(source, target);

      const amountDiff = diff.columnDiffs.find((c) => c.column === 'amount');
      const bioDiff = diff.columnDiffs.find((c) => c.column === 'bio');

      expect(amountDiff).toBeDefined();
      expect(amountDiff?.description).toContain('type: decimal(10,2) unsigned → decimal(8,2)');

      expect(bioDiff).toBeDefined();
      expect(bioDiff?.description).toContain('type: string(255) → string(100)');
    });
  });

  describe('index comparison', () => {
    it('should detect indexes to create', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const sourceTable = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);
      const emailColumn = sourceTable.columns.get('email');
      source.addIndex({
        name: 'idx_users_email',
        table: sourceTable,
        columns: [emailColumn],
        unique: true,
        source: 'entity',
        syncStatus: 'entity_only',
      });

      const targetTable = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);

      source.addTable(sourceTable);
      target.addTable(targetTable);

      const differ = new SchemaASTDiffer();
      const diff = differ.diff(source, target, { compareIndexes: true });

      expect(diff.hasDifferences).toBe(true);
      expect(diff.indexDiffs.some((i) => i.name === 'idx_users_email' && i.type === 'create')).toBe(true);
    });

    it('should detect indexes to drop', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const sourceTable = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);

      const targetTable = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);
      const targetEmailColumn = targetTable.columns.get('email');
      target.addIndex({
        name: 'idx_users_email',
        table: targetTable,
        columns: [targetEmailColumn],
        unique: true,
        source: 'entity',
        syncStatus: 'entity_only',
      });

      source.addTable(sourceTable);
      target.addTable(targetTable);

      const differ = new SchemaASTDiffer();
      const diff = differ.diff(source, target, { compareIndexes: true });

      expect(diff.hasDifferences).toBe(true);
      expect(diff.indexDiffs.some((i) => i.name === 'idx_users_email' && i.type === 'drop')).toBe(true);
    });

    it('should detect altered index', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const table1 = createTable('users', [{ name: 'id', isPrimaryKey: true }, { name: 'email' }]);
      const table2 = createTable('users', [{ name: 'id', isPrimaryKey: true }, { name: 'email' }]);

      source.addTable(table1);
      target.addTable(table2);

      source.addIndex({
        name: 'idx_email',
        table: table1,
        columns: [table1.columns.get('email')],
        unique: true,
      });

      target.addIndex({
        name: 'idx_email',
        table: table2,
        columns: [table2.columns.get('email')],
        unique: false, // Changed uniqueness
      });

      const differ = new SchemaASTDiffer();
      const diff = differ.diff(source, target, { compareIndexes: true });

      expect(diff.hasDifferences).toBe(true);
      expect(diff.indexDiffs.some((i) => i.type === 'alter')).toBe(true);
    });

    it('should detect altered index column change', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const table1 = createTable('users', [{ name: 'id', isPrimaryKey: true }, { name: 'email' }, { name: 'login' }]);
      const table2 = createTable('users', [{ name: 'id', isPrimaryKey: true }, { name: 'email' }, { name: 'login' }]);

      source.addTable(table1);
      target.addTable(table2);

      source.addIndex({
        name: 'idx_unique',
        table: table1,
        columns: [table1.columns.get('email')],
        unique: true,
      });

      target.addIndex({
        name: 'idx_unique',
        table: table2,
        columns: [table2.columns.get('login')], // Changed column
        unique: true,
      });

      const differ = new SchemaASTDiffer();
      const diff = differ.diff(source, target, { compareIndexes: true });

      expect(diff.hasDifferences).toBe(true);
      expect(diff.indexDiffs.some((i) => i.type === 'alter')).toBe(true);
    });

    it('should detect altered index type change', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const table1 = createTable('users', [{ name: 'id', isPrimaryKey: true }, { name: 'email' }]);
      const table2 = createTable('users', [{ name: 'id', isPrimaryKey: true }, { name: 'email' }]);

      source.addTable(table1);
      target.addTable(table2);

      source.addIndex({
        name: 'idx_email',
        table: table1,
        columns: [table1.columns.get('email')],
        unique: true,
        type: 'btree',
      });

      target.addIndex({
        name: 'idx_email',
        table: table2,
        columns: [table2.columns.get('email')],
        unique: true,
        type: 'hash', // Changed type
      });

      const differ = new SchemaASTDiffer();
      const diff = differ.diff(source, target, { compareIndexes: true });

      expect(diff.indexDiffs.some((i) => i.type === 'alter')).toBe(true);
    });
  });

  describe('relationship comparison', () => {
    it('should detect relationships to create', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const users = createTable('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const posts = createTable('posts', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'author_id', type: { category: 'integer' } },
      ]);

      source.addTable(users);
      source.addTable(posts);
      target.addTable(users);
      target.addTable(posts);

      source.addRelationship({
        name: 'fk_posts_users',
        type: 'ManyToOne',
        from: { table: posts, columns: [posts.columns.get('author_id')] },
        to: { table: users, columns: [users.columns.get('id')] },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });

      const differ = new SchemaASTDiffer();
      const diff = differ.diff(source, target, { compareRelationships: true });

      expect(diff.hasDifferences).toBe(true);
      expect(diff.relationshipDiffs.some((r) => r.name === 'fk_posts_users' && r.type === 'create')).toBe(true);
    });

    it('should detect relationships to drop', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const users = createTable('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const posts = createTable('posts', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'author_id', type: { category: 'integer' } },
      ]);

      source.addTable(users);
      source.addTable(posts);
      target.addTable(users);
      target.addTable(posts);

      target.addRelationship({
        name: 'fk_posts_users',
        type: 'ManyToOne',
        from: { table: posts, columns: [posts.columns.get('author_id')] },
        to: { table: users, columns: [users.columns.get('id')] },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });

      const differ = new SchemaASTDiffer();
      const diff = differ.diff(source, target, { compareRelationships: true });

      expect(diff.hasDifferences).toBe(true);
      expect(diff.relationshipDiffs.some((r) => r.name === 'fk_posts_users' && r.type === 'drop')).toBe(true);
    });

    it('should detect relationship action changes', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const users = createTable('users', [{ name: 'id', isPrimaryKey: true }]);
      const posts = createTable('posts', [
        { name: 'id', isPrimaryKey: true },
        { name: 'author_id', type: { category: 'integer' } },
      ]);
      source.addTable(users);
      source.addTable(posts);
      target.addTable(users);
      target.addTable(posts);

      const sourceAuthor = posts.columns.get('author_id');
      const sourceId = users.columns.get('id');
      source.addRelationship({
        name: 'fk_posts_users',
        type: 'ManyToOne',
        from: { table: posts, columns: [sourceAuthor] },
        to: { table: users, columns: [sourceId] },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });

      const targetAuthor = posts.columns.get('author_id');
      const targetId = users.columns.get('id');
      target.addRelationship({
        name: 'fk_posts_users',
        type: 'ManyToOne',
        from: { table: posts, columns: [targetAuthor] },
        to: { table: users, columns: [targetId] },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      });

      const differ = new SchemaASTDiffer();
      const diff = differ.diff(source, target, { compareRelationships: true });

      expect(diff.hasDifferences).toBe(true);
      expect(diff.relationshipDiffs.some((r) => r.type === 'alter')).toBe(true);
    });

    it('should detect no differences for identical indexes', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();
      const t1 = createTable('users', [{ name: 'id', isPrimaryKey: true }, { name: 'email' }]);
      const t2 = createTable('users', [{ name: 'id', isPrimaryKey: true }, { name: 'email' }]);
      source.addTable(t1);
      target.addTable(t2);
      const idx1 = { name: 'idx_email', table: t1, columns: [t1.columns.get('email')], unique: true };
      const idx2 = { name: 'idx_email', table: t2, columns: [t2.columns.get('email')], unique: true };
      source.addIndex(idx1 as any);
      target.addIndex(idx2 as any);
      const result = new SchemaASTDiffer().diff(source, target, { compareIndexes: true });
      expect(result.indexDiffs.length).toBe(0);
    });

    it('should detect no differences for identical relationships', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();
      const t1 = createTable('users', [{ name: 'id', isPrimaryKey: true }]);
      const t2 = createTable('users', [{ name: 'id', isPrimaryKey: true }]);
      source.addTable(t1);
      target.addTable(t2);
      const rel1 = {
        name: 'fk_1',
        from: { table: t1, columns: [t1.columns.get('id')] },
        to: { table: t1, columns: [t1.columns.get('id')] },
        onDelete: 'CASCADE',
      };
      const rel2 = {
        name: 'fk_1',
        from: { table: t2, columns: [t2.columns.get('id')] },
        to: { table: t2, columns: [t2.columns.get('id')] },
        onDelete: 'CASCADE',
      };
      source.addRelationship(rel1 as any);
      target.addRelationship(rel2 as any);
      const result = new SchemaASTDiffer().diff(source, target, { compareRelationships: true });
      expect(result.relationshipDiffs.length).toBe(0);
    });

    it('should handle default onDelete/onUpdate actions in relationship diff', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();
      const t1 = createTable('users', [{ name: 'id', isPrimaryKey: true }]);
      const t2 = createTable('users', [{ name: 'id', isPrimaryKey: true }]);
      source.addTable(t1);
      target.addTable(t2);

      // One has explicit 'NO ACTION', other has undefined (which defaults to 'NO ACTION')
      const rel1 = {
        name: 'fk_1',
        from: { table: t1, columns: [t1.columns.get('id')] },
        to: { table: t1, columns: [t1.columns.get('id')] },
        onDelete: 'NO ACTION',
      };
      const rel2 = {
        name: 'fk_1',
        from: { table: t2, columns: [t2.columns.get('id')] },
        to: { table: t2, columns: [t2.columns.get('id')] },
        // onDelete undefined
      };
      source.addRelationship(rel1 as any);
      target.addRelationship(rel2 as any);

      const result = new SchemaASTDiffer().diff(source, target, { compareRelationships: true });
      expect(result.relationshipDiffs.length).toBe(0);
    });
  });

  describe('Utility Functions', () => {
    it('should normalize default values', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const table1 = createTable('users', [
        { name: 'id', isPrimaryKey: true },
        { name: 'created_at', defaultValue: 'now()' },
      ]);
      const table2 = createTable('users', [
        { name: 'id', isPrimaryKey: true },
        { name: 'created_at', defaultValue: 'CURRENT_TIMESTAMP' },
      ]);

      source.addTable(table1);
      target.addTable(table2);

      const differ = new SchemaASTDiffer();
      const diff = differ.diff(source, target);

      expect(diff.hasDifferences).toBe(false);
    });

    it('should handle other default values in normalizeDefault', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const table1 = createTable('users', [
        { name: 'id', isPrimaryKey: true },
        { name: 'age', defaultValue: 25 },
      ]);
      const table2 = createTable('users', [
        { name: 'id', isPrimaryKey: true },
        { name: 'age', defaultValue: '25' },
      ]);

      source.addTable(table1);
      target.addTable(table2);

      const differ = new SchemaASTDiffer();
      const diff = differ.diff(source, target);

      expect(diff.hasDifferences).toBe(false);
    });

    it('should use diffSchemas convenience function', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const diff = diffSchemas(source, target);
      expect(diff.hasDifferences).toBe(false);
    });
  });

  describe('excludeTables', () => {
    it('should ignore excluded tables', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      source.addTable(createTable('users', [{ name: 'id', isPrimaryKey: true }]));
      source.addTable(createTable('ignored', [{ name: 'id', isPrimaryKey: true }]));

      const differ = new SchemaASTDiffer();
      const diff = differ.diff(source, target, { excludeTables: ['ignored'] });

      expect(diff.tablesToCreate.length).toBe(1);
      expect(diff.tablesToCreate[0].name).toBe('users');
    });
  });
});
