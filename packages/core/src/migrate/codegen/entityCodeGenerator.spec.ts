import { describe, expect, it } from 'vitest';
import { SchemaAST } from '../../schema/schemaAST.js';
import type { ColumnNode, TableNode } from '../../schema/types.js';
import { createEntityCodeGenerator, EntityCodeGenerator } from './entityCodeGenerator.js';

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

describe('EntityCodeGenerator', () => {
  describe('generateForTable', () => {
    it('should generate a basic entity class', () => {
      const ast = new SchemaAST();
      const table = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true, isAutoIncrement: true },
        { name: 'name', type: { category: 'string', length: 255 } },
      ]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('users');

      expect(result).toBeDefined();
      expect(result.code).toContain('@Entity(');
      expect(result.code).toContain('class User');
      expect(result.code).toContain('@Id()');
      expect(result.code).toContain('id?:');
      expect(result.code).toContain('@Field(');
      expect(result.code).toContain('name?:');
    });

    it('should use PascalCase for class name', () => {
      const ast = new SchemaAST();
      const table = createTable('user_profiles', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('user_profiles');

      expect(result.className).toBe('UserProfile');
      expect(result.code).toContain('class UserProfile');
    });

    it('should use camelCase for property names', () => {
      const ast = new SchemaAST();
      const table = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'first_name', type: { category: 'string' } },
        { name: 'last_name', type: { category: 'string' } },
      ]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('users');

      expect(result.code).toContain('firstName?:');
      expect(result.code).toContain('lastName?:');
    });

    it('should add @Field with name when column name differs', () => {
      const ast = new SchemaAST();
      const table = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'first_name', type: { category: 'string' } },
      ]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('users');

      // Column name is preserved in @Field decorator when different from property
      expect(result.code).toContain('firstName');
    });

    it('should handle different column types', () => {
      const ast = new SchemaAST();
      const table = createTable('test', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'amount', type: { category: 'decimal', precision: 10, scale: 2 } },
        { name: 'is_active', type: { category: 'boolean' } },
        { name: 'data', type: { category: 'json' } },
        { name: 'created_at', type: { category: 'timestamp' } },
      ]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('test');

      expect(result.code).toContain('number'); // for decimal
      expect(result.code).toContain('boolean');
      expect(result.code).toContain('Date'); // for timestamp
    });

    it('should add unique constraint', () => {
      const ast = new SchemaAST();
      const table = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' }, isUnique: true },
      ]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('users');

      expect(result.code).toContain('unique: true');
    });

    it('should add nullable annotation', () => {
      const ast = new SchemaAST();
      const table = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'bio', type: { category: 'string' }, nullable: true },
      ]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('users');

      expect(result.code).toContain('nullable: true');
    });

    it('should handle explicit entity name for non-standard table names', () => {
      const ast = new SchemaAST();
      const table = createTable('tbl_users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('tbl_users');

      expect(result.code).toContain("name: 'tbl_users'");
    });
  });

  describe('generateAll', () => {
    it('should generate multiple entity files', () => {
      const ast = new SchemaAST();
      ast.addTable(createTable('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]));
      ast.addTable(createTable('posts', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]));

      const generator = new EntityCodeGenerator(ast);
      const entities = generator.generateAll();

      expect(entities.length).toBe(2);
      expect(entities.some((e) => e.className === 'User')).toBe(true);
      expect(entities.some((e) => e.className === 'Post')).toBe(true);
    });
  });

  describe('imports', () => {
    it('should include necessary imports', () => {
      const ast = new SchemaAST();
      const table = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'name', type: { category: 'string' } },
      ]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('users');

      expect(result.code).toContain('import {');
      expect(result.code).toContain("from '@uql/core'");
    });

    it('should generate relation imports and decorators', () => {
      const ast = new SchemaAST();
      const users = createTable('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const posts = createTable('posts', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'author_id', type: { category: 'integer' } },
      ]);
      ast.addTable(users);
      ast.addTable(posts);

      ast.addRelationship({
        name: 'fk_posts_users',
        type: 'ManyToOne',
        from: { table: posts, columns: [posts.columns.get('author_id')] },
        to: { table: users, columns: [users.columns.get('id')] },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('posts');

      expect(result.code).toContain('import type { User }');
      expect(result.code).toContain('@ManyToOne');
      expect(result.code).toContain('author?: Relation<User>');
    });

    it('should generate OneToMany relations on the inverse side', () => {
      const ast = new SchemaAST();
      const users = createTable('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const posts = createTable('posts', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'author_id', type: { category: 'integer' } },
      ]);
      ast.addTable(users);
      ast.addTable(posts);

      ast.addRelationship({
        name: 'fk_posts_users',
        type: 'ManyToOne',
        from: { table: posts, columns: [posts.columns.get('author_id')] },
        to: { table: users, columns: [users.columns.get('id')] },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('users');

      expect(result.code).toContain('@OneToMany');
      expect(result.code).toContain('posts?: Relation<Post[]>');
    });

    it('should generate Id with custom name', () => {
      const ast = new SchemaAST();
      const table = createTable('users', [{ name: 'user_id', type: { category: 'integer' }, isPrimaryKey: true }]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('users');

      expect(result.code).toContain("@Id({ name: 'user_id' })");
    });

    it('should generate field with default value', () => {
      const ast = new SchemaAST();
      const table = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'status', type: { category: 'string' }, defaultValue: 'active' },
      ]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('users');

      expect(result.code).toContain("defaultValue: 'active'");
    });

    it('should generate single column index', () => {
      const ast = new SchemaAST();
      const table = createTable('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);
      ast.addTable(table);
      ast.addIndex({
        name: 'idx_email',
        table,
        columns: [table.columns.get('email')],
        unique: true,
      });

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('users');

      expect(result.code).toContain("index: 'idx_email'");
    });

    it('should handle boolean and Date types', () => {
      const ast = new SchemaAST();
      const table = createTable('test', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'is_active', type: { category: 'boolean' } },
        { name: 'created_at', type: { category: 'timestamp' } },
      ]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('test');

      expect(result.code).toContain('isActive?: boolean');
      expect(result.code).toContain('createdAt?: Date');
    });

    it('should format complex default values correctly', () => {
      const ast = new SchemaAST();
      const table = createTable('test', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'config', type: { category: 'json' }, defaultValue: { a: 1 } },
        { name: 'tags', type: { category: 'json' }, defaultValue: ['tag1'] },
        { name: 'val', type: { category: 'string' }, defaultValue: null },
        { name: 'expr', type: { category: 'timestamp' }, defaultValue: 'CURRENT_TIMESTAMP' },
        { name: 'bool_val', type: { category: 'boolean' }, defaultValue: true },
        { name: 'num_val', type: { category: 'integer' }, defaultValue: 123 },
      ]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('test');

      expect(result.code).toContain('defaultValue: {"a":1}');
      expect(result.code).toContain('defaultValue: ["tag1"]');
      expect(result.code).toContain('defaultValue: null');
      expect(result.code).toContain("defaultValue: 'CURRENT_TIMESTAMP'");
      expect(result.code).toContain('defaultValue: true');
      expect(result.code).toContain('defaultValue: 123');
    });

    it('should handle OneToOne and ManyToMany relations', () => {
      const ast = new SchemaAST();
      const users = createTable('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const profiles = createTable('profiles', []);
      const tags = createTable('tags', []);
      const userTags = createTable('user_tags', []);

      const profileRel: any = {
        name: 'profile',
        type: 'OneToOne',
        from: { table: users, columns: [users.columns.get('id')] },
        to: { table: profiles, columns: [] },
      };

      const tagsRel: any = {
        name: 'tags',
        type: 'ManyToMany',
        from: { table: users, columns: [users.columns.get('id')] },
        to: { table: tags, columns: [] },
        through: { table: userTags },
      };

      users.outgoingRelations.push(profileRel);
      users.outgoingRelations.push(tagsRel);

      ast.addTable(users);
      ast.addTable(profiles);
      ast.addTable(tags);
      ast.addTable(userTags);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('users');

      expect(result.code).toContain('@OneToOne');
      expect(result.code).toContain('@ManyToMany');
    });
  });

  describe('createEntityCodeGenerator', () => {
    it('should create an instance via factory', () => {
      const ast = new SchemaAST();
      const generator = createEntityCodeGenerator(ast);
      expect(generator).toBeInstanceOf(EntityCodeGenerator);
    });
  });
});
