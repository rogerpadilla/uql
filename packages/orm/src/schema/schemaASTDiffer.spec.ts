import { describe, expect, it } from 'vitest';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { columnsOf, mockTableNode } from '../test/index.js';
import { engineType } from './canonicalType.js';
import type { IndexFacet } from './indexDifferences.js';
import { SchemaAST } from './schemaAST.js';
import { columnRenames, diffSchemas, tableRenameCandidates } from './schemaASTDiffer.js';
import { SqlExpression } from './sqlExpression.js';
import type { ColumnNode, IndexNode, RelationshipNode } from './types.js';

/** What two schemas alike differ by. */
const NO_DIFFERENCES = {
  tables: [],
  columns: [],
  indexes: [],
  checks: [],
  triggers: [],
  primaryKeys: [],
  relationships: [],
};

/** Which change a diff is, named as a migration makes it. */
const kindOf = (change: { readonly from?: unknown; readonly to?: unknown }) =>
  change.from === undefined ? 'create' : change.to === undefined ? 'drop' : 'alter';

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

      expect(diff).toEqual(NO_DIFFERENCES);
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

      expect(diff.columns).toHaveLength(1);
      expect(diff.columns[0]).toMatchObject({ changed: ['type'] });
      // Either direction drops half the range, so it is not something safe mode may apply.
      expect(diff.columns[0].isBreaking).toBe(true);
    });

    /** A bare `DATETIME` holds whole seconds on MySQL, so `DATETIME(3)` widens it rather than narrowing. */
    it('should judge a change breaking by the types the engine stores', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();
      source.addTable(mockTableNode('users', [{ name: 'at', type: { category: 'timestamp', precision: 3 } }]));
      target.addTable(mockTableNode('users', [{ name: 'at', type: { category: 'timestamp', precision: 0 } }]));

      const diff = diffSchemas(source, target, { normalizeType: engineType(new MySqlDialect()) });

      expect(diff.columns).toHaveLength(1);
      expect(diff.columns[0].isBreaking).toBe(false);
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

      expect(diff.columns).toHaveLength(1);
      expect(diff.columns[0]).toMatchObject({ changed: ['default'] });
      expect(diff.columns[0].isBreaking).toBe(false);
    });

    it('should detect tables to create', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const table = mockTableNode('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      source.addTable(table);
      const diff = diffSchemas(source, target);

      expect(diff.tables).toEqual([{ to: table }]);
    });

    it('should detect tables to drop', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const table = mockTableNode('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      target.addTable(table);
      const diff = diffSchemas(source, target);

      expect(diff.tables).toEqual([{ from: table }]);
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

      expect(diff.columns.some((c) => c.column === 'email' && kindOf(c) === 'create')).toBe(true);
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

      expect(diff.columns.some((c) => c.column === 'email' && kindOf(c) === 'drop')).toBe(true);
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

      expect(diff.columns.some((c) => c.column === 'age' && kindOf(c) === 'alter')).toBe(true);
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

      expect(diff.columns).toMatchObject([{ changed: ['nullable'] }]);
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

      expect(diffSchemas(source, target).columns).toEqual([]);
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
      expect(result.columns[0]).toMatchObject({
        changed: ['default'],
        from: { defaultValue: 20 },
        to: { defaultValue: 30 },
      });
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
      expect(diffSchemas(source, target).columns).toEqual([]);
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

      expect(diff.columns.map((columnDiff) => columnDiff.isBreaking)).toEqual([true]);
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

      const amountDiff = diff.columns.find((c) => c.column === 'amount');
      const bioDiff = diff.columns.find((c) => c.column === 'bio');

      expect(amountDiff).toMatchObject({ changed: ['type'] });

      expect(bioDiff).toMatchObject({ changed: ['type'] });
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
      const diff = diffSchemas(source, target);

      expect(diff.indexes.some((i) => i.name === 'users__email_idx' && kindOf(i) === 'create')).toBe(true);
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
      const diff = diffSchemas(source, target);

      expect(diff.indexes.some((i) => i.name === 'users__email_idx' && kindOf(i) === 'drop')).toBe(true);
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

      const diff = diffSchemas(source, target);

      expect(diff.indexes).toEqual([]);
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

      const diff = diffSchemas(source, target);

      expect(diff.indexes.map((index) => [index.name, kindOf(index)])).toEqual([['users_email_uq', 'drop']]);
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

      const diff = diffSchemas(source, target);

      expect(diff.indexes.map((index) => [index.name, kindOf(index)])).toEqual([['users__email_idx', 'alter']]);
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
      const diff = diffSchemas(source, target);

      expect(diff.indexes.some((i) => kindOf(i) === 'alter')).toBe(true);
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
      const diff = diffSchemas(source, target);

      expect(diff.indexes.some((i) => kindOf(i) === 'alter')).toBe(true);
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
      const diff = diffSchemas(source, target);

      expect(diff.indexes.some((i) => kindOf(i) === 'alter')).toBe(true);
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
      const diff = diffSchemas(source, target);

      expect(diff.relationships.some((r) => r.name === 'posts_users_fk' && kindOf(r) === 'create')).toBe(true);
    });

    /** Each column pairs with the one it points at: the same columns paired otherwise are another key. */
    it('should tell a composite foreign key from the same columns paired otherwise', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();
      const parent = mockTableNode('parent', [{ name: 'x' }, { name: 'y' }]);
      const child = mockTableNode('child', [{ name: 'a' }, { name: 'b' }]);
      for (const ast of [source, target]) {
        ast.addTable(parent);
        ast.addTable(child);
      }
      const keyTo = (targets: string[]) => ({
        name: 'child_parent_fk',
        type: 'ManyToOne' as const,
        from: { table: child, columns: columnsOf(child, 'a', 'b') },
        to: { table: parent, columns: columnsOf(parent, ...targets) },
      });
      source.addRelationship(keyTo(['x', 'y']));
      target.addRelationship(keyTo(['y', 'x']));

      expect(diffSchemas(source, target).relationships.map(kindOf)).toEqual(['create', 'drop']);
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
      const diff = diffSchemas(source, target);

      expect(diff.relationships.some((r) => r.name === 'posts_users_fk' && kindOf(r) === 'drop')).toBe(true);
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
      const diff = diffSchemas(source, target);

      expect(diff.relationships.some((r) => kindOf(r) === 'alter')).toBe(true);
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
      const result = diffSchemas(source, target);
      expect(result.indexes.length).toBe(0);
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
      const result = diffSchemas(source, target);
      expect(result.relationships.length).toBe(0);
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

      const result = diffSchemas(source, target);
      expect(result.relationships.length).toBe(0);
    });
  });

  describe('Utility Functions', () => {
    /** No dialect renders them here, so SQL is alike only to the letter, and never a literal that spells it. */
    it('should compare defaults as written where no dialect is given', () => {
      const diffOf = (expected: unknown, actual: unknown) => {
        const source = new SchemaAST();
        const target = new SchemaAST();
        source.addTable(
          mockTableNode('users', [
            { name: 'id', isPrimaryKey: true },
            { name: 'at', defaultValue: expected },
          ]),
        );
        target.addTable(
          mockTableNode('users', [
            { name: 'id', isPrimaryKey: true },
            { name: 'at', defaultValue: actual },
          ]),
        );
        return diffSchemas(source, target).columns.length > 0;
      };

      expect(diffOf(SqlExpression.parenthesized('now()'), SqlExpression.parenthesized('now()'))).toBe(false);
      expect(diffOf(SqlExpression.parenthesized('now()'), SqlExpression.parenthesized('CURRENT_TIMESTAMP'))).toBe(true);
      expect(diffOf('CURRENT_TIMESTAMP', SqlExpression.parenthesized('CURRENT_TIMESTAMP'))).toBe(true);
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

      expect(diff).toEqual(NO_DIFFERENCES);
    });

    it('should use diffSchemas convenience function', () => {
      const source = new SchemaAST();
      const target = new SchemaAST();

      const diff = diffSchemas(source, target);
      expect(diff).toEqual(NO_DIFFERENCES);
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
      return diffSchemas(sourceSchema, targetSchema).indexes;
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

      expect(diff.tables).toEqual([{ to: expect.objectContaining({ name: 'users' }) }]);
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

    /** A check or trigger uql installs is named for its table, so a renamed table differs by them alone. */
    it('should name a table whose checks and triggers differ only by the table they are named for', () => {
      const desired = new SchemaAST();
      const current = new SchemaAST();
      const posts = mockTableNode('posts', [...columns]);
      posts.checks.push({ name: '_uql_posts__ck_aaaaaa', expression: 'id > 0' });
      posts.triggers.push({ name: '_uql_posts__audit_bbbbbb', statements: [] });
      const articles = mockTableNode('articles', [...columns]);
      articles.checks.push({ name: '_uql_articles__ck_cccccc', expression: 'id > 0' });
      articles.triggers.push({ name: '_uql_articles__audit_dddddd', statements: [] });
      desired.addTable(posts);
      current.addTable(articles);

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
