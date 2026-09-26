import { describe, expect, it } from 'vitest';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { columnsOf, mockTableNode } from '../test/index.js';
import { engineType } from './canonicalType.js';
import type { IndexFacet } from './indexDifferences.js';
import { SchemaAST } from './schemaAST.js';
import { columnRenames, diffSchemas, tableRenameCandidates } from './schemaASTDiffer.js';
import type { ColumnNode, IndexNode, RelationshipNode } from './types.js';

/** An index as one side of a comparison declares it, over the `users` fixture below. */
type IndexParts = Partial<Pick<IndexNode, 'entries' | 'unique' | 'type' | 'where' | 'include'>>;

describe('SchemaASTDiffer', () => {
  describe('diff', () => {
    it('should detect no differences for identical schemas', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const table1 = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'name', type: { category: 'string' } },
      ]);
      const table2 = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'name', type: { category: 'string' } },
      ]);

      source.addTable(table1);
      target.addTable(table2);
      const diff = diffSchemas(source, target);

      expect(diff.hasDifferences).toBe(false);
      expect(diff.tablesToCreate.length).toBe(0);
      expect(diff.tablesToDrop.length).toBe(0);
    });

    /**
     * The exception to the rule above, and the migration path off the unsigned keys MySQL schemas were
     * created with: a key left unsigned refuses every foreign key pointing at it, because the
     * referencing column takes its type from the canonical one, which is signed.
     */
    it('should report signedness on a generated key, which is the one part that round trips', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();
      const key = { name: 'id', isPrimaryKey: true, isAutoIncrement: true, type: { category: 'integer' } } as const;
      source.addTable(mockTableNode('users', [key]));
      target.addTable(mockTableNode('users', [{ ...key, type: { category: 'integer', unsigned: true } }]));

      const diff = diffSchemas(source, target);

      expect(diff.columnDiffs).toHaveLength(1);
      expect(diff.columnDiffs[0].description).toContain('type');
      // Either direction drops half the range, so it is not something safe mode may apply.
      expect(diff.columnDiffs[0].isBreaking).toBe(true);
    });

    /** A bare `DATETIME` holds whole seconds on MySQL, so `DATETIME(3)` widens it rather than narrowing. */
    it('should judge a change breaking by the types the engine stores', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();
      source.addTable(mockTableNode('users', [{ name: 'at', type: { category: 'timestamp', precision: 3 } }]));
      target.addTable(mockTableNode('users', [{ name: 'at', type: { category: 'timestamp', precision: 0 } }]));

      const diff = diffSchemas(source, target, { normalizeType: engineType(new MySqlDialect()) });

      expect(diff.columnDiffs).toHaveLength(1);
      expect(diff.columnDiffs[0].isBreaking).toBe(false);
    });

    it('should not call a column breaking for a type it never compared', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();
      // A generated key: its type is the dialect's own serial spelling, which does not round trip
      // (`BIGINT AUTO_INCREMENT` reads back as `BIGINT(20)`), so the diff skips it. The column still
      // differs - in its default - and that difference loses nothing.
      const key = { name: 'id', isPrimaryKey: true, isAutoIncrement: true } as const;
      source.addTable(mockTableNode('users', [{ ...key, type: { category: 'integer' }, defaultValue: 1 }]));
      target.addTable(mockTableNode('users', [{ ...key, type: { category: 'integer', size: 'big' } }]));

      const diff = diffSchemas(source, target);

      expect(diff.columnDiffs).toHaveLength(1);
      expect(diff.columnDiffs[0].description).toContain('default');
      expect(diff.columnDiffs[0].description).not.toContain('type');
      expect(diff.columnDiffs[0].isBreaking).toBe(false);
    });

    it('should detect tables to create', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const table = mockTableNode('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      source.addTable(table);
      const diff = diffSchemas(source, target);

      expect(diff.hasDifferences).toBe(true);
      expect(diff.tablesToCreate.length).toBe(1);
      expect(diff.tablesToCreate[0].name).toBe('users');
    });

    it('should detect tables to drop', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const table = mockTableNode('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      target.addTable(table);
      const diff = diffSchemas(source, target);

      expect(diff.hasDifferences).toBe(true);
      expect(diff.tablesToDrop.length).toBe(1);
      expect(diff.tablesToDrop[0].name).toBe('users');
    });

    it('should detect columns to add', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const sourceTable = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'name', type: { category: 'string' } },
        { name: 'email', type: { category: 'string' } },
      ]);
      const targetTable = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'name', type: { category: 'string' } },
      ]);

      source.addTable(sourceTable);
      target.addTable(targetTable);
      const diff = diffSchemas(source, target);

      expect(diff.hasDifferences).toBe(true);
      expect(diff.columnDiffs.some((c) => c.column === 'email' && c.type === 'add')).toBe(true);
    });

    it('should detect columns to drop', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const sourceTable = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'name', type: { category: 'string' } },
      ]);
      const targetTable = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'name', type: { category: 'string' } },
        { name: 'email', type: { category: 'string' } },
      ]);

      source.addTable(sourceTable);
      target.addTable(targetTable);
      const diff = diffSchemas(source, target);

      expect(diff.hasDifferences).toBe(true);
      expect(diff.columnDiffs.some((c) => c.column === 'email' && c.type === 'drop')).toBe(true);
    });

    it('should detect column type changes', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const sourceTable = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'age', type: { category: 'integer' } },
      ]);
      const targetTable = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'age', type: { category: 'string' } },
      ]);

      source.addTable(sourceTable);
      target.addTable(targetTable);
      const diff = diffSchemas(source, target);

      expect(diff.hasDifferences).toBe(true);
      expect(diff.columnDiffs.some((c) => c.column === 'age' && c.type === 'alter')).toBe(true);
    });

    it('should detect nullable changes', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const sourceTable = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' }, nullable: false },
      ]);
      const targetTable = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' }, nullable: true },
      ]);

      source.addTable(sourceTable);
      target.addTable(targetTable);
      const diff = diffSchemas(source, target);

      expect(diff.hasDifferences).toBe(true);
    });

    /**
     * No engine turns a column into an identity, or out of one, without rewriting the table, and
     * there is no DDL here that does it - so reporting the difference could only ever produce drift
     * nothing settles, and the statements emitted for it did not change it either.
     */
    it('should not report an auto-increment change it has no way to settle', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();
      source.addTable(mockTableNode('users', [{ name: 'id', isPrimaryKey: true, isAutoIncrement: true }]));
      target.addTable(mockTableNode('users', [{ name: 'id', isPrimaryKey: true, isAutoIncrement: false }]));

      expect(diffSchemas(source, target).columnDiffs).toEqual([]);
    });

    it('should detect default value changes', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();
      source.addTable(
        mockTableNode('users', [
          { name: 'id', isPrimaryKey: true },
          { name: 'age', defaultValue: 30 },
        ]),
      );
      target.addTable(
        mockTableNode('users', [
          { name: 'id', isPrimaryKey: true },
          { name: 'age', defaultValue: 20 },
        ]),
      );
      const result = diffSchemas(source, target);
      expect(result.columnDiffs[0].description).toContain('default: 20 -> 30');
    });

    /** A unique column is a unique index, compared with the indexes, so the column alone differs in nothing. */
    it('should leave uniqueness to the indexes', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();
      source.addTable(
        mockTableNode('users', [
          { name: 'id', isPrimaryKey: true },
          { name: 'email', isUnique: true },
        ]),
      );
      target.addTable(
        mockTableNode('users', [
          { name: 'id', isPrimaryKey: true },
          { name: 'email', isUnique: false },
        ]),
      );
      expect(diffSchemas(source, target).columnDiffs).toEqual([]);
    });

    it('should use case-insensitive comparison when configured', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const sourceTable = mockTableNode('Users', [{ name: 'ID', type: { category: 'integer' }, isPrimaryKey: true }]);
      const targetTable = mockTableNode('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);

      source.addTable(sourceTable);
      target.addTable(targetTable);
      const diff = diffSchemas(source, target, { ignoreCase: true });

      // With case insensitive, tables should match
      expect(diff.tablesToCreate.length).toBe(0);
      expect(diff.tablesToDrop.length).toBe(0);
    });

    it('should detect breaking changes', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const sourceTable = mockTableNode('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const targetTable = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);

      source.addTable(sourceTable);
      target.addTable(targetTable);
      const diff = diffSchemas(source, target);

      expect(diff.hasBreakingChanges).toBe(true);
    });

    it('should format meaningful type differences (size, precision, scale, unsigned)', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const sourceTable = mockTableNode('users', [
        { name: 'id', isPrimaryKey: true },
        { name: 'amount', type: { category: 'decimal', precision: 10, scale: 2, unsigned: true } },
        { name: 'bio', type: { category: 'string', length: 255 } },
      ]);
      const targetTable = mockTableNode('users', [
        { name: 'id', isPrimaryKey: true },
        { name: 'amount', type: { category: 'decimal', precision: 8, scale: 2 } },
        { name: 'bio', type: { category: 'string', length: 100 } },
      ]);

      source.addTable(sourceTable);
      target.addTable(targetTable);
      const diff = diffSchemas(source, target);

      const amountDiff = diff.columnDiffs.find((c) => c.column === 'amount');
      const bioDiff = diff.columnDiffs.find((c) => c.column === 'bio');

      expect(amountDiff).toBeDefined();
      expect(amountDiff?.description).toContain('type: decimal(10,2) unsigned -> decimal(8,2)');

      expect(bioDiff).toBeDefined();
      expect(bioDiff?.description).toContain('type: string(255) -> string(100)');
    });
  });

  describe('index comparison', () => {
    it('should detect indexes to create', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const sourceTable = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);
      source.addIndex({
        name: 'users__email_idx',
        table: sourceTable,
        entries: [{ column: 'email' }],
        unique: true,
      });

      const targetTable = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);

      source.addTable(sourceTable);
      target.addTable(targetTable);
      const diff = diffSchemas(source, target, { compareIndexes: true });

      expect(diff.hasDifferences).toBe(true);
      expect(diff.indexDiffs.some((i) => i.name === 'users__email_idx' && i.type === 'create')).toBe(true);
    });

    it('should detect indexes to drop', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const sourceTable = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);

      const targetTable = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);
      target.addIndex({
        name: 'users__email_idx',
        table: targetTable,
        entries: [{ column: 'email' }],
        unique: true,
      });

      source.addTable(sourceTable);
      target.addTable(targetTable);
      const diff = diffSchemas(source, target, { compareIndexes: true });

      expect(diff.hasDifferences).toBe(true);
      expect(diff.indexDiffs.some((i) => i.name === 'users__email_idx' && i.type === 'drop')).toBe(true);
    });

    /** The generator already takes an index of the same shape as the one it wants; drift must agree. */
    it('should match an index of the same shape under another name', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();
      const sourceTable = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }, { name: 'email' }]);
      const targetTable = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }, { name: 'email' }]);
      source.addIndex({ name: 'users__email_idx', table: sourceTable, entries: [{ column: 'email' }], unique: false });
      target.addIndex({ name: 'legacy_email', table: targetTable, entries: [{ column: 'email' }], unique: false });
      source.addTable(sourceTable);
      target.addTable(targetTable);

      const diff = diffSchemas(source, target, { compareIndexes: true });

      expect(diff.indexDiffs).toEqual([]);
    });

    it('should report a duplicate of an index the entity asked for', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();
      const sourceTable = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }, { name: 'email' }]);
      const targetTable = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }, { name: 'email' }]);
      source.addIndex({ name: 'users__email_idx', table: sourceTable, entries: [{ column: 'email' }], unique: true });
      for (const name of ['users__email_uk', 'users_email_uq']) {
        target.addIndex({ name, table: targetTable, entries: [{ column: 'email' }], unique: true });
      }
      source.addTable(sourceTable);
      target.addTable(targetTable);

      const diff = diffSchemas(source, target, { compareIndexes: true });

      expect(diff.indexDiffs.map((index) => [index.name, index.type])).toEqual([['users_email_uq', 'drop']]);
    });

    it('should still report a same-shape index that differs in a compared attribute', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();
      const sourceTable = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }, { name: 'email' }]);
      const targetTable = mockTableNode(
        'users',
        [{ name: 'id', isPrimaryKey: true }, { name: 'email' }],
        undefined,
        new Set(['order']),
      );
      source.addIndex({
        name: 'users__email_idx',
        table: sourceTable,
        entries: [{ column: 'email', order: 'desc' }],
        unique: false,
      });
      target.addIndex({ name: 'legacy_email', table: targetTable, entries: [{ column: 'email' }], unique: false });
      source.addTable(sourceTable);
      target.addTable(targetTable);

      const diff = diffSchemas(source, target, { compareIndexes: true });

      expect(diff.indexDiffs.map((index) => [index.name, index.type])).toEqual([['users__email_idx', 'alter']]);
    });

    it('should detect altered index', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const table1 = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }, { name: 'email' }]);
      const table2 = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }, { name: 'email' }]);

      source.addTable(table1);
      target.addTable(table2);

      source.addIndex({
        name: 'email_idx',
        table: table1,
        entries: [{ column: 'email' }],
        unique: true,
      });

      target.addIndex({
        name: 'email_idx',
        table: table2,
        entries: [{ column: 'email' }],
        unique: false, // Changed uniqueness
      });
      const diff = diffSchemas(source, target, { compareIndexes: true });

      expect(diff.hasDifferences).toBe(true);
      expect(diff.indexDiffs.some((i) => i.type === 'alter')).toBe(true);
    });

    it('should detect altered index column change', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const table1 = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }, { name: 'email' }, { name: 'login' }]);
      const table2 = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }, { name: 'email' }, { name: 'login' }]);

      source.addTable(table1);
      target.addTable(table2);

      source.addIndex({
        name: 'unique_idx',
        table: table1,
        entries: [{ column: 'email' }],
        unique: true,
      });

      target.addIndex({
        name: 'unique_idx',
        table: table2,
        // Changed column
        entries: [{ column: 'login' }],
        unique: true,
      });
      const diff = diffSchemas(source, target, { compareIndexes: true });

      expect(diff.hasDifferences).toBe(true);
      expect(diff.indexDiffs.some((i) => i.type === 'alter')).toBe(true);
    });

    it('should detect altered index type change', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const table1 = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }, { name: 'email' }]);
      const table2 = mockTableNode(
        'users',
        [{ name: 'id', isPrimaryKey: true }, { name: 'email' }],
        undefined,
        new Set(['accessMethod']),
      );

      source.addTable(table1);
      target.addTable(table2);

      source.addIndex({
        name: 'email_idx',
        table: table1,
        entries: [{ column: 'email' }],
        unique: true,
        type: 'btree',
      });

      target.addIndex({
        name: 'email_idx',
        table: table2,
        entries: [{ column: 'email' }],
        unique: true,
        type: 'hash', // Changed type
      });
      const diff = diffSchemas(source, target, { compareIndexes: true });

      expect(diff.indexDiffs.some((i) => i.type === 'alter')).toBe(true);
    });
  });

  describe('relationship comparison', () => {
    it('should detect relationships to create', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const users = mockTableNode('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const posts = mockTableNode('posts', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'author_id', type: { category: 'integer' } },
      ]);

      source.addTable(users);
      source.addTable(posts);
      target.addTable(users);
      target.addTable(posts);

      source.addRelationship({
        name: 'posts_users_fk',
        type: 'ManyToOne',
        from: { table: posts, columns: columnsOf(posts, 'author_id') },
        to: { table: users, columns: columnsOf(users, 'id') },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });
      const diff = diffSchemas(source, target, { compareRelationships: true });

      expect(diff.hasDifferences).toBe(true);
      expect(diff.relationshipDiffs.some((r) => r.name === 'posts_users_fk' && r.type === 'create')).toBe(true);
    });

    it('should detect relationships to drop', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const users = mockTableNode('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const posts = mockTableNode('posts', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'author_id', type: { category: 'integer' } },
      ]);

      source.addTable(users);
      source.addTable(posts);
      target.addTable(users);
      target.addTable(posts);

      target.addRelationship({
        name: 'posts_users_fk',
        type: 'ManyToOne',
        from: { table: posts, columns: columnsOf(posts, 'author_id') },
        to: { table: users, columns: columnsOf(users, 'id') },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });
      const diff = diffSchemas(source, target, { compareRelationships: true });

      expect(diff.hasDifferences).toBe(true);
      expect(diff.relationshipDiffs.some((r) => r.name === 'posts_users_fk' && r.type === 'drop')).toBe(true);
    });

    it('should detect relationship action changes', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const users = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }]);
      const posts = mockTableNode('posts', [
        { name: 'id', isPrimaryKey: true },
        { name: 'author_id', type: { category: 'integer' } },
      ]);
      source.addTable(users);
      source.addTable(posts);
      target.addTable(users);
      target.addTable(posts);

      source.addRelationship({
        name: 'posts_users_fk',
        type: 'ManyToOne',
        from: { table: posts, columns: columnsOf(posts, 'author_id') },
        to: { table: users, columns: columnsOf(users, 'id') },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });

      target.addRelationship({
        name: 'posts_users_fk',
        type: 'ManyToOne',
        from: { table: posts, columns: columnsOf(posts, 'author_id') },
        to: { table: users, columns: columnsOf(users, 'id') },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      });
      const diff = diffSchemas(source, target, { compareRelationships: true });

      expect(diff.hasDifferences).toBe(true);
      expect(diff.relationshipDiffs.some((r) => r.type === 'alter')).toBe(true);
    });

    it('should detect no differences for identical indexes', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();
      const t1 = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }, { name: 'email' }]);
      const t2 = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }, { name: 'email' }]);
      source.addTable(t1);
      target.addTable(t2);
      const idx1 = {
        name: 'email_idx',
        table: t1,
        columns: columnsOf(t1, 'email'),
        entries: [{ column: 'email' }],
        unique: true,
      };
      const idx2 = {
        name: 'email_idx',
        table: t2,
        columns: columnsOf(t2, 'email'),
        entries: [{ column: 'email' }],
        unique: true,
      };
      source.addIndex(idx1);
      target.addIndex(idx2);
      const result = diffSchemas(source, target, { compareIndexes: true });
      expect(result.indexDiffs.length).toBe(0);
    });

    it('should detect no differences for identical relationships', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();
      const t1 = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }]);
      const t2 = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }]);
      source.addTable(t1);
      target.addTable(t2);
      const rel1: RelationshipNode = {
        name: '1_fk',
        type: 'ManyToOne',
        from: { table: t1, columns: columnsOf(t1, 'id') },
        to: { table: t1, columns: columnsOf(t1, 'id') },
        onDelete: 'CASCADE',
      };
      const rel2: RelationshipNode = {
        name: '1_fk',
        type: 'ManyToOne',
        from: { table: t2, columns: columnsOf(t2, 'id') },
        to: { table: t2, columns: columnsOf(t2, 'id') },
        onDelete: 'CASCADE',
      };
      source.addRelationship(rel1);
      target.addRelationship(rel2);
      const result = diffSchemas(source, target, { compareRelationships: true });
      expect(result.relationshipDiffs.length).toBe(0);
    });

    it('should handle default onDelete/onUpdate actions in relationship diff', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();
      const t1 = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }]);
      const t2 = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }]);
      source.addTable(t1);
      target.addTable(t2);

      // One has explicit 'NO ACTION', other has undefined (which defaults to 'NO ACTION')
      const rel1: RelationshipNode = {
        name: '1_fk',
        type: 'ManyToOne',
        from: { table: t1, columns: columnsOf(t1, 'id') },
        to: { table: t1, columns: columnsOf(t1, 'id') },
        onDelete: 'NO ACTION',
      };
      const rel2: RelationshipNode = {
        name: '1_fk',
        type: 'ManyToOne',
        from: { table: t2, columns: columnsOf(t2, 'id') },
        to: { table: t2, columns: columnsOf(t2, 'id') },
        // onDelete undefined
      };
      source.addRelationship(rel1);
      target.addRelationship(rel2);

      const result = diffSchemas(source, target, { compareRelationships: true });
      expect(result.relationshipDiffs.length).toBe(0);
    });
  });

  describe('Utility Functions', () => {
    it('should normalize default values', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const table1 = mockTableNode('users', [
        { name: 'id', isPrimaryKey: true },
        { name: 'created_at', defaultValue: 'now()' },
      ]);
      const table2 = mockTableNode('users', [
        { name: 'id', isPrimaryKey: true },
        { name: 'created_at', defaultValue: 'CURRENT_TIMESTAMP' },
      ]);

      source.addTable(table1);
      target.addTable(table2);
      const diff = diffSchemas(source, target);

      expect(diff.hasDifferences).toBe(false);
    });

    it('should handle other default values in normalizeDefault', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const table1 = mockTableNode('users', [
        { name: 'id', isPrimaryKey: true },
        { name: 'age', defaultValue: 25 },
      ]);
      const table2 = mockTableNode('users', [
        { name: 'id', isPrimaryKey: true },
        { name: 'age', defaultValue: '25' },
      ]);

      source.addTable(table1);
      target.addTable(table2);
      const diff = diffSchemas(source, target);

      expect(diff.hasDifferences).toBe(false);
    });

    it('should use diffSchemas convenience function', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const diff = diffSchemas(source, target);
      expect(diff.hasDifferences).toBe(false);
    });
  });

  /**
   * The entity declares an index in full, the database reports only what its catalogue describes.
   * Half these cases pin that a real edit is reported, half that the database restating what was
   * asked for is not - the latter would report the same drift after every migration.
   */
  describe('index features', () => {
    const diffIndexes = (source: IndexParts, target: IndexParts, facets: IndexFacet[]) => {
      const sourceSchema = new SchemaAST();
      const targetSchema = new SchemaAST();
      const sourceTable = mockTableNode('users', [{ name: 'id', isPrimaryKey: true }, { name: 'email' }]);
      const targetTable = mockTableNode(
        'users',
        [{ name: 'id', isPrimaryKey: true }, { name: 'email' }],
        undefined,
        new Set(facets),
      );
      sourceSchema.addTable(sourceTable);
      targetSchema.addTable(targetTable);
      sourceSchema.addIndex({
        name: 'users__email_idx',
        table: sourceTable,
        entries: [],
        unique: false,
        ...source,
      });
      targetSchema.addIndex({
        name: 'users__email_idx',
        table: targetTable,
        entries: [],
        unique: false,
        ...target,
      });
      return diffSchemas(sourceSchema, targetSchema, { compareIndexes: true }).indexDiffs;
    };

    it('should leave the entries of an expression index uncompared, whatever the text says', () => {
      const diffs = diffIndexes(
        { entries: [{ column: 'lower(email)', expression: true }] },
        { entries: [{ column: 'upper(email)', expression: true }] },
        [],
      );

      expect(diffs).toEqual([]);
    });

    it('should still compare the rest of an index whose expression it cannot read', () => {
      const diffs = diffIndexes(
        { entries: [{ column: 'lower(email)', expression: true }], unique: true },
        { unique: false },
        [],
      );

      expect(diffs.length).toBe(1);
      expect(diffs[0].description).toBe('unique: false -> true');
    });

    it('should accept a nulls order the entity left to the default the database states', () => {
      const diffs = diffIndexes(
        { entries: [{ column: 'email' }] },
        { entries: [{ column: 'email', order: 'asc', nulls: 'last' }] },
        ['nulls'],
      );

      expect(diffs).toEqual([]);
    });

    it('should report a nulls order the entity asked for against the engine default', () => {
      const diffs = diffIndexes(
        { entries: [{ column: 'email', nulls: 'first' }] },
        { entries: [{ column: 'email', order: 'asc', nulls: 'last' }] },
        ['nulls'],
      );

      expect(diffs.length).toBe(1);
    });

    it('should accept an access method the database does not name', () => {
      const diffs = diffIndexes(
        { entries: [{ column: 'email' }], type: 'gin' },
        { entries: [{ column: 'email' }] },
        [],
      );

      expect(diffs).toEqual([]);
    });

    it('should report an access method that differs from the one the database names', () => {
      const diffs = diffIndexes(
        { entries: [{ column: 'email' }], type: 'gin' },
        { entries: [{ column: 'email' }], type: 'btree' },
        ['accessMethod'],
      );

      expect(diffs.length).toBe(1);
      expect(diffs[0].description).toContain('type: btree -> gin');
    });

    it('should accept a covering index whose stored columns were listed in another order', () => {
      const diffs = diffIndexes(
        { entries: [{ column: 'email' }], include: ['status', 'name'] },
        { entries: [{ column: 'email' }], include: ['name', 'status'] },
        ['include'],
      );

      expect(diffs).toEqual([]);
    });

    it('should report an operator class the entity asked for and the database does not have', () => {
      const diffs = diffIndexes(
        { entries: [{ column: 'data', opsClass: 'jsonb_path_ops' }] },
        { entries: [{ column: 'data' }] },
        ['opsClass'],
      );

      expect(diffs.length).toBe(1);
      expect(diffs[0].description).toContain('jsonb_path_ops');
    });

    it('should report a covering index whose stored columns changed', () => {
      const diffs = diffIndexes(
        { entries: [{ column: 'email' }], include: ['status'] },
        { entries: [{ column: 'email' }] },
        ['include'],
      );

      expect(diffs.length).toBe(1);
      expect(diffs[0].description).toContain('include');
    });
  });

  describe('excludeTables', () => {
    it('should ignore excluded tables', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      source.addTable(mockTableNode('users', [{ name: 'id', isPrimaryKey: true }]));
      source.addTable(mockTableNode('ignored', [{ name: 'id', isPrimaryKey: true }]));
      const diff = diffSchemas(source, target, { excludeTables: ['ignored'] });

      expect(diff.tablesToCreate.length).toBe(1);
      expect(diff.tablesToCreate[0].name).toBe('users');
    });
  });

  describe('columnRenames', () => {
    const id = { name: 'id', type: { category: 'integer' }, isPrimaryKey: true } as const;
    const text = { type: { category: 'string', length: 255 } } as const;

    /** The entities' `users` against the database's, each holding `id` and the columns given. */
    function renamesOf(expected: Partial<ColumnNode>[], actual: Partial<ColumnNode>[]) {
      const desired = new SchemaAST();
      const current = new SchemaAST();
      desired.addTable(mockTableNode('users', [id, ...expected]));
      current.addTable(mockTableNode('users', [id, ...actual]));
      return columnRenames(desired, current);
    }

    it('should rename the one column a new one is identical to but for its name', () => {
      expect(renamesOf([{ name: 'headline', ...text }], [{ name: 'title', ...text }])).toEqual(
        new Map([['users', [{ from: 'title', to: 'headline' }]]]),
      );
    });

    it('should not rename a column whose type changes too', () => {
      expect(renamesOf([{ name: 'headline', ...text }], [{ name: 'title', type: { category: 'integer' } }]).size).toBe(
        0,
      );
    });

    it('should not rename a column whose nullability changes too', () => {
      expect(renamesOf([{ name: 'headline', ...text, nullable: false }], [{ name: 'title', ...text }]).size).toBe(0);
    });

    it('should not rename a column whose default changes too', () => {
      expect(renamesOf([{ name: 'headline', ...text, defaultValue: 'a' }], [{ name: 'title', ...text }]).size).toBe(0);
    });

    it('should not rename where two columns could have been renamed', () => {
      expect(
        renamesOf(
          [{ name: 'headline', ...text }],
          [
            { name: 'title', ...text },
            { name: 'subtitle', ...text },
          ],
        ).size,
      ).toBe(0);
    });

    it('should not rename across tables', () => {
      const desired = new SchemaAST();
      const current = new SchemaAST();
      desired.addTable(mockTableNode('users', [id, { name: 'headline', ...text }]));
      current.addTable(mockTableNode('users', [id]));
      current.addTable(mockTableNode('posts', [id, { name: 'title', ...text }]));

      expect(columnRenames(desired, current).size).toBe(0);
    });
  });

  describe('tableRenameCandidates', () => {
    const columns = [
      { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
      { name: 'name', type: { category: 'string', length: 255 } },
    ] as const;

    it('should name the one table the database holds with the same columns as a new one', () => {
      const desired = new SchemaAST();
      const current = new SchemaAST();
      desired.addTable(mockTableNode('posts', [...columns]));
      current.addTable(mockTableNode('articles', [...columns]));

      expect(tableRenameCandidates(desired, current)).toEqual([{ from: 'articles', to: 'posts' }]);
    });

    it('should name none where a column differs', () => {
      const desired = new SchemaAST();
      const current = new SchemaAST();
      desired.addTable(mockTableNode('posts', [...columns]));
      current.addTable(mockTableNode('articles', [columns[0]]));

      expect(tableRenameCandidates(desired, current)).toEqual([]);
    });
  });
});
