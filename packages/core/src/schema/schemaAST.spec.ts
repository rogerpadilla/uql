import { beforeEach, describe, expect, it } from 'vitest';
import { SchemaAST } from './schemaAST.js';
import type { ColumnNode, IndexNode, RelationshipNode, TableNode } from './types.js';

describe('SchemaAST', () => {
  let ast: SchemaAST;

  beforeEach(() => {
    ast = new SchemaAST();
  });

  describe('Table Operations', () => {
    it('should add and retrieve tables', () => {
      const table = createTable('users');
      ast.addTable(table);

      expect(ast.getTable('users')).toBe(table);
      expect(ast.getTableNames()).toEqual(['users']);
    });

    it('should remove tables and their relationships', () => {
      const users = createTable('users');
      const posts = createTable('posts');
      ast.addTable(users);
      ast.addTable(posts);

      const rel = createRelationship('fk_posts_user', posts, users);
      ast.addRelationship(rel);

      expect(ast.relationships.length).toBe(1);

      ast.removeTable('posts');

      expect(ast.getTable('posts')).toBeUndefined();
      expect(ast.relationships.length).toBe(0);
    });

    it('should return undefined for non-existent table', () => {
      expect(ast.getTable('nonexistent')).toBeUndefined();
    });

    it('should return false when removing non-existent table', () => {
      expect(ast.removeTable('nonexistent')).toBe(false);
    });
  });

  describe('Graph Navigation', () => {
    it('should get referenced column', () => {
      const users = createTable('users');
      const posts = createTable('posts');
      const rel = createRelationship('fk_posts_user', posts, users);
      ast.addTable(users);
      ast.addTable(posts);
      ast.addRelationship(rel);

      const authorCol = posts.columns.get('col1');
      expect(ast.getReferencedColumn(authorCol)).toBe(users.columns.get('col0'));
    });
    it('should get dependent tables', () => {
      const users = createTable('users');
      const posts = createTable('posts');
      ast.addTable(users);
      ast.addTable(posts);

      const rel = createRelationship('fk_posts_user', posts, users);
      ast.addRelationship(rel);

      const dependents = ast.getDependentTables(users);
      expect(dependents).toContain(posts);
    });

    it('should get dependencies', () => {
      const users = createTable('users');
      const posts = createTable('posts');
      ast.addTable(users);
      ast.addTable(posts);

      const rel = createRelationship('fk_posts_user', posts, users);
      ast.addRelationship(rel);

      const deps = ast.getDependencies(posts);
      expect(deps).toContain(users);
    });

    it('should get relationship between tables', () => {
      const users = createTable('users');
      const posts = createTable('posts');
      ast.addTable(users);
      ast.addTable(posts);

      const rel = createRelationship('fk_posts_user', posts, users);
      ast.addRelationship(rel);

      expect(ast.getRelationship(posts, users)).toBe(rel);
      expect(ast.getRelationship(users, posts)).toBeUndefined();
    });

    it('should get all table relationships', () => {
      const users = createTable('users');
      const posts = createTable('posts');
      const comments = createTable('comments');
      ast.addTable(users);
      ast.addTable(posts);
      ast.addTable(comments);

      const rel1 = createRelationship('fk_posts_user', posts, users);
      const rel2 = createRelationship('fk_comments_user', comments, users);
      ast.addRelationship(rel1);
      ast.addRelationship(rel2);

      const userRels = ast.getTableRelationships(users);
      expect(userRels.length).toBe(2);
    });
  });

  describe('Circular Dependency Detection', () => {
    it('should detect no circular dependencies in linear graph', () => {
      const users = createTable('users');
      const posts = createTable('posts');
      const comments = createTable('comments');
      ast.addTable(users);
      ast.addTable(posts);
      ast.addTable(comments);

      ast.addRelationship(createRelationship('fk_posts_user', posts, users));
      ast.addRelationship(createRelationship('fk_comments_post', comments, posts));

      expect(ast.hasCircularDependencies()).toBe(false);
      expect(ast.detectCircularDependencies()).toEqual([]);
    });

    it('should detect circular dependencies', () => {
      const tableA = createTable('table_a');
      const tableB = createTable('table_b');
      ast.addTable(tableA);
      ast.addTable(tableB);

      // A -> B and B -> A creates a cycle
      ast.addRelationship(createRelationship('fk_a_b', tableA, tableB));
      ast.addRelationship(createRelationship('fk_b_a', tableB, tableA));

      expect(ast.hasCircularDependencies()).toBe(true);
      const cycles = ast.detectCircularDependencies();
      expect(cycles.length).toBeGreaterThan(0);
    });
  });

  describe('Topological Sort', () => {
    it('should return tables in correct CREATE order', () => {
      const users = createTable('users');
      const posts = createTable('posts');
      const comments = createTable('comments');
      ast.addTable(comments);
      ast.addTable(posts);
      ast.addTable(users);

      ast.addRelationship(createRelationship('fk_posts_user', posts, users));
      ast.addRelationship(createRelationship('fk_comments_post', comments, posts));

      const order = ast.getCreateOrder();
      const names = order.map((t) => t.name);

      // users must come before posts, posts must come before comments
      expect(names.indexOf('users')).toBeLessThan(names.indexOf('posts'));
      expect(names.indexOf('posts')).toBeLessThan(names.indexOf('comments'));
    });

    it('should return tables in correct DROP order', () => {
      const users = createTable('users');
      const posts = createTable('posts');
      ast.addTable(users);
      ast.addTable(posts);

      ast.addRelationship(createRelationship('fk_posts_user', posts, users));

      const order = ast.getDropOrder();
      const names = order.map((t) => t.name);

      // posts must be dropped before users
      expect(names.indexOf('posts')).toBeLessThan(names.indexOf('users'));
    });
  });

  describe('Validation', () => {
    it('should pass validation for valid schema', () => {
      const users = createTable('users');
      ast.addTable(users);

      const errors = ast.validate();
      expect(errors).toEqual([]);
      expect(ast.isValid()).toBe(true);
    });

    it('should detect duplicate index names', () => {
      const users = createTable('users');
      ast.addTable(users);

      const idx1: IndexNode = {
        name: 'idx_duplicate',
        table: users,
        columns: [],
        unique: false,
      };
      const idx2: IndexNode = {
        name: 'idx_duplicate',
        table: users,
        columns: [],
        unique: false,
      };

      ast.addIndex(idx1);
      ast.addIndex(idx2);

      const errors = ast.validate();
      expect(errors.some((e) => e.type === 'duplicate_index')).toBe(true);
    });

    it('should detect missing FK target', () => {
      const users = createTable('users');
      const posts = createTable('posts');
      ast.addTable(posts);
      // users is NOT added to ast

      const rel = createRelationship('fk_posts_users', posts, users);
      ast.relationships.push(rel);

      const errors = ast.validate();
      expect(errors.some((e) => e.type === 'missing_fk_target')).toBe(true);
    });

    it('should detect circular dependencies in validate', () => {
      const a = createTable('a');
      const b = createTable('b');
      ast.addTable(a);
      ast.addTable(b);
      ast.addRelationship(createRelationship('fk_a_b', a, b));
      ast.addRelationship(createRelationship('fk_b_a', b, a));

      const errors = ast.validate();
      expect(errors.some((e) => e.type === 'circular_dependency')).toBe(true);
    });
  });

  describe('Junction Table Detection', () => {
    it('should detect junction tables', () => {
      const users = createTable('users');
      const roles = createTable('roles');
      const userRoles = createTable('user_roles', 3); // id, user_id, role_id
      ast.addTable(users);
      ast.addTable(roles);
      ast.addTable(userRoles);

      ast.addRelationship(createRelationship('fk_user', userRoles, users));
      ast.addRelationship(createRelationship('fk_role', userRoles, roles));

      expect(ast.isJunctionTable(userRoles)).toBe(true);
      expect(ast.isJunctionTable(users)).toBe(false);
    });

    it('should not detect as junction if too many columns', () => {
      const users = createTable('users');
      const roles = createTable('roles');
      const userRoles = createTable('user_roles', 10); // Too many columns
      ast.addTable(users);
      ast.addTable(roles);
      ast.addTable(userRoles);

      ast.addRelationship(createRelationship('fk_user', userRoles, users));
      ast.addRelationship(createRelationship('fk_role', userRoles, roles));

      expect(ast.isJunctionTable(userRoles)).toBe(false);
    });
  });

  describe('Relation Type Inference', () => {
    it('should infer ManyToOne for non-unique FK', () => {
      const users = createTable('users');
      const posts = createTable('posts');
      ast.addTable(users);
      ast.addTable(posts);

      const rel = createRelationship('fk_posts_user', posts, users);
      ast.addRelationship(rel);

      expect(ast.inferRelationType(rel)).toBe('ManyToOne');
    });

    it('should infer OneToOne for unique FK', () => {
      const users = createTable('users');
      const profiles = createTable('profiles');
      ast.addTable(users);
      ast.addTable(profiles);

      const rel = createRelationship('fk_profiles_user', profiles, users, true);
      ast.addRelationship(rel);

      expect(ast.inferRelationType(rel)).toBe('OneToOne');
    });

    it('should infer ManyToMany for junction table', () => {
      const posts = createTable('posts');
      const tags = createTable('tags');
      const postTags = createTable('post_tags', 3);
      ast.addTable(posts);
      ast.addTable(tags);
      ast.addTable(postTags);

      const rel1 = createRelationship('fk_pt_posts', postTags, posts);
      const rel2 = createRelationship('fk_pt_tags', postTags, tags);
      ast.addRelationship(rel1);
      ast.addRelationship(rel2);

      expect(ast.inferRelationType(rel1)).toBe('ManyToMany');
    });

    it('should get inverse relation type', () => {
      expect(ast.getInverseRelationType('OneToMany')).toBe('ManyToOne');
      expect(ast.getInverseRelationType('ManyToOne')).toBe('OneToMany');
      expect(ast.getInverseRelationType('OneToOne')).toBe('OneToOne');
      expect(ast.getInverseRelationType('ManyToMany')).toBe('ManyToMany');
    });
  });

  describe('Index Operations', () => {
    it('should add and find indexes', () => {
      const users = createTable('users');
      ast.addTable(users);

      const idx: IndexNode = {
        name: 'idx_users_email',
        table: users,
        columns: [],
        unique: true,
      };

      ast.addIndex(idx);

      expect(ast.getIndex('idx_users_email')).toBe(idx);
      expect(ast.getTableIndexes('users')).toContain(idx);
    });
  });

  describe('Relationship Operations', () => {
    it('should add and remove relationships', () => {
      const users = createTable('users');
      const posts = createTable('posts');
      ast.addTable(users);
      ast.addTable(posts);

      const rel = createRelationship('fk_posts_user', posts, users);
      ast.addRelationship(rel);

      expect(ast.relationships.length).toBe(1);

      ast.removeRelationship('fk_posts_user');

      expect(ast.relationships.length).toBe(0);
    });

    it('should return false when removing non-existent relationship', () => {
      expect(ast.removeRelationship('nonexistent')).toBe(false);
    });
  });

  describe('Clone', () => {
    it('should create a deep clone', () => {
      const users = createTable('users');
      const posts = createTable('posts');
      ast.addTable(users);
      ast.addTable(posts);

      ast.addRelationship(createRelationship('fk_posts_user', posts, users));
      ast.addIndex({
        name: 'idx_users_name',
        table: users,
        columns: [users.columns.get('col1')],
        unique: false,
      });

      const clone = ast.clone();

      expect(clone.tables.size).toBe(2);
      expect(clone.relationships.length).toBe(1);
      expect(clone.indexes.length).toBe(1);
      expect(clone.getTable('users')).not.toBe(users);
      expect(clone.getTable('users')?.name).toBe('users');
      expect(clone.getIndex('idx_users_name')).toBeDefined();
      expect(clone.getIndex('idx_users_name')?.table.name).toBe('users');
    });
  });

  describe('Statistics', () => {
    it('should return correct stats', () => {
      const users = createTable('users', 3);
      const posts = createTable('posts', 4);
      ast.addTable(users);
      ast.addTable(posts);

      ast.addRelationship(createRelationship('fk_posts_user', posts, users));

      const stats = ast.getStats();

      expect(stats.tableCount).toBe(2);
      expect(stats.columnCount).toBe(7);
      expect(stats.relationshipCount).toBe(1);
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const users = createTable('users');
      const posts = createTable('posts');
      ast.addTable(users);
      ast.addTable(posts);
      ast.addRelationship(createRelationship('fk_posts_user', posts, users));
      ast.addIndex({
        name: 'idx_users_name',
        table: users,
        columns: [users.columns.get('col1')],
        unique: false,
      });

      const json: any = ast.toJSON();

      expect(json).toHaveProperty('tables');
      expect(json).toHaveProperty('relationships');
      expect(json.tables[0].indexes.length).toBeGreaterThan(0);
      expect(json.relationships.length).toBe(1);
    });
  });
});

// Helper functions

function createTable(name: string, columnCount = 2): TableNode {
  const columns = new Map<string, ColumnNode>();
  const table: TableNode = {
    name,
    columns,
    primaryKey: [],
    indexes: [],
    schema: undefined as unknown as SchemaAST,
    incomingRelations: [],
    outgoingRelations: [],
  };

  for (let i = 0; i < columnCount; i++) {
    const col: ColumnNode = {
      name: `col${i}`,
      type: { category: 'string' },
      nullable: true,
      isPrimaryKey: i === 0,
      isAutoIncrement: i === 0,
      isUnique: false,
      table,
      referencedBy: [],
    };
    columns.set(col.name, col);
    if (i === 0) {
      (table as { primaryKey: ColumnNode[] }).primaryKey = [col];
    }
  }

  return table;
}

function createRelationship(name: string, from: TableNode, to: TableNode, isUnique = false): RelationshipNode {
  const fromCol = Array.from(from.columns.values())[1] ?? Array.from(from.columns.values())[0];
  const toCol = Array.from(to.columns.values())[0];

  if (isUnique) {
    (fromCol as { isUnique: boolean }).isUnique = true;
  }

  return {
    name,
    type: 'ManyToOne',
    from: { table: from, columns: [fromCol] },
    to: { table: to, columns: [toCol] },
  };
}
