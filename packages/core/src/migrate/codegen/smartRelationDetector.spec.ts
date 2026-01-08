import { describe, expect, it } from 'vitest';
import { SchemaAST } from '../../schema/schemaAST.js';
import type { ColumnNode, TableNode } from '../../schema/types.js';
import { createRelationDetector, SmartRelationDetector } from './smartRelationDetector.js';

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

describe('SmartRelationDetector', () => {
  describe('constructor', () => {
    it('should create instance', () => {
      const ast = new SchemaAST();
      const detector = new SmartRelationDetector(ast);
      expect(detector).toBeDefined();
    });

    it('should accept options', () => {
      const ast = new SchemaAST();
      const detector = new SmartRelationDetector(ast, {
        minConfidence: 0.8,
      });
      expect(detector).toBeDefined();
    });
  });

  describe('createRelationDetector', () => {
    it('should create detector via factory function', () => {
      const ast = new SchemaAST();
      const detector = createRelationDetector(ast);
      expect(detector).toBeDefined();
    });
  });

  describe('detectAll', () => {
    it('should return empty array for empty schema', () => {
      const ast = new SchemaAST();
      const detector = new SmartRelationDetector(ast);
      const relations = detector.detectAll();
      expect(Array.isArray(relations)).toBe(true);
    });

    it('should detect relations from existing relationships', () => {
      const ast = new SchemaAST();

      const usersTable = createTable('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const postsTable = createTable('posts', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'user_id', type: { category: 'integer' } },
      ]);

      ast.addTable(usersTable);
      ast.addTable(postsTable);

      // Add a relationship
      ast.addRelationship({
        name: 'fk_posts_users',
        type: 'ManyToOne',
        from: { table: postsTable, columns: [postsTable.columns.get('user_id')] },
        to: { table: usersTable, columns: [usersTable.columns.get('id')] },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
        inferredFrom: 'explicit_fk',
      });

      const detector = new SmartRelationDetector(ast);
      const relations = detector.detectAll();

      expect(relations.length).toBeGreaterThan(0);
    });

    it('should detect ManyToMany relations from junction tables', () => {
      const ast = new SchemaAST();

      const postsTable = createTable('posts', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const tagsTable = createTable('tags', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const postTagsTable = createTable('post_tags', [
        { name: 'post_id', type: { category: 'integer' } },
        { name: 'tag_id', type: { category: 'integer' } },
      ]);

      ast.addTable(postsTable);
      ast.addTable(tagsTable);
      ast.addTable(postTagsTable);

      ast.addRelationship({
        name: 'fk_pt_posts',
        type: 'ManyToOne',
        from: { table: postTagsTable, columns: [postTagsTable.columns.get('post_id')] },
        to: { table: postsTable, columns: [postsTable.columns.get('id')] },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });

      ast.addRelationship({
        name: 'fk_pt_tags',
        type: 'ManyToOne',
        from: { table: postTagsTable, columns: [postTagsTable.columns.get('tag_id')] },
        to: { table: tagsTable, columns: [tagsTable.columns.get('id')] },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });

      const detector = new SmartRelationDetector(ast);
      const relations = detector.detectAll();

      expect(relations.some((r) => r.type === 'ManyToMany')).toBe(true);
    });

    it('should detect OneToOne relations from unique FKs', () => {
      const ast = new SchemaAST();

      const usersTable = createTable('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const profilesTable = createTable('profiles', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'user_id', type: { category: 'integer' }, isUnique: true },
      ]);

      ast.addTable(usersTable);
      ast.addTable(profilesTable);

      ast.addRelationship({
        name: 'fk_profiles_users',
        type: 'ManyToOne',
        from: { table: profilesTable, columns: [profilesTable.columns.get('user_id')] },
        to: { table: usersTable, columns: [usersTable.columns.get('id')] },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });

      const detector = new SmartRelationDetector(ast);
      const relations = detector.detectAll();

      expect(relations.some((r) => r.type === 'OneToOne')).toBe(true);
    });
  });
});
