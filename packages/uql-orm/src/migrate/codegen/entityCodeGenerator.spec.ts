import { describe, expect, it } from 'vitest';
import { SchemaAST } from '../../schema/schemaAST.js';
import { mockTableNode } from '../../test/index.js';
import { createEntityCodeGenerator, EntityCodeGenerator } from './entityCodeGenerator.js';

describe('EntityCodeGenerator', () => {
  describe('generateForTable', () => {
    it('should generate a basic entity class', () => {
      const ast = new SchemaAST();
      const table = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true, isAutoIncrement: true },
        { name: 'name', type: { category: 'string', length: 255 } },
      ]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('users');

      expect(result).toBeDefined();
      expect(result!.code).toContain('@Entity(');
      expect(result!.code).toContain('class User');
      expect(result!.code).toContain('@Id()');
      expect(result!.code).toContain('id?:');
      expect(result!.code).toContain('@Field(');
      expect(result!.code).toContain('name?:');
    });

    it('should use PascalCase for class name', () => {
      const ast = new SchemaAST();
      const table = mockTableNode('user_profiles', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('user_profiles');

      expect(result!.className).toBe('UserProfile');
      expect(result!.code).toContain('class UserProfile');
    });

    it('should use camelCase for property names', () => {
      const ast = new SchemaAST();
      const table = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'first_name', type: { category: 'string' } },
        { name: 'last_name', type: { category: 'string' } },
      ]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('users');

      expect(result!.code).toContain('firstName?:');
      expect(result!.code).toContain('lastName?:');
    });

    it('should add @Field with name when column name differs', () => {
      const ast = new SchemaAST();
      const table = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'first_name', type: { category: 'string' } },
      ]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('users');

      // Column name is preserved in @Field decorator when different from property
      expect(result!.code).toContain('firstName');
    });

    it('should handle different column types', () => {
      const ast = new SchemaAST();
      const table = mockTableNode('test', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'amount', type: { category: 'decimal', precision: 10, scale: 2 } },
        { name: 'is_active', type: { category: 'boolean' } },
        { name: 'data', type: { category: 'json' } },
        { name: 'created_at', type: { category: 'timestamp' } },
      ]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('test');

      expect(result!.code).toContain('number'); // for decimal
      expect(result!.code).toContain('boolean');
      expect(result!.code).toContain('Date'); // for timestamp
    });

    it('should add unique constraint', () => {
      const ast = new SchemaAST();
      const table = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' }, isUnique: true },
      ]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('users');

      expect(result!.code).toContain('unique: true');
    });

    it('should add nullable annotation', () => {
      const ast = new SchemaAST();
      const table = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'bio', type: { category: 'string' }, nullable: true },
      ]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('users');

      expect(result!.code).toContain('nullable: true');
    });

    it('should handle explicit entity name for non-standard table names', () => {
      const ast = new SchemaAST();
      const table = mockTableNode('tbl_users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('tbl_users');

      expect(result!.code).toContain("name: 'tbl_users'");
    });
  });

  describe('generateAll', () => {
    it('should generate multiple entity files', () => {
      const ast = new SchemaAST();
      ast.addTable(mockTableNode('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]));
      ast.addTable(mockTableNode('posts', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]));

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
      const table = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'name', type: { category: 'string' } },
      ]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('users');

      expect(result!.code).toContain('import {');
      expect(result!.code).toContain("from 'uql-orm'");
    });

    it('should generate relation imports and decorators', () => {
      const ast = new SchemaAST();
      const users = mockTableNode('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const posts = mockTableNode('posts', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'author_id', type: { category: 'integer' } },
      ]);
      ast.addTable(users);
      ast.addTable(posts);

      ast.addRelationship({
        name: 'fk_posts_users',
        type: 'ManyToOne',
        from: { table: posts, columns: [posts.columns.get('author_id')!] },
        to: { table: users, columns: [users.columns.get('id')!] },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('posts');

      expect(result!.code).toContain('import { User } from');
      expect(result!.code).toContain('@ManyToOne');
      expect(result!.code).toContain('author?: User');
    });

    it('should carry a real referential action from introspection into the relation decorator', () => {
      const ast = new SchemaAST();
      const users = mockTableNode('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const posts = mockTableNode('posts', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'author_id', type: { category: 'integer' } },
      ]);
      ast.addTable(users);
      ast.addTable(posts);

      ast.addRelationship({
        name: 'fk_posts_users',
        type: 'ManyToOne',
        from: { table: posts, columns: [posts.columns.get('author_id')!] },
        to: { table: users, columns: [users.columns.get('id')!] },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('posts');

      expect(result!.code).toContain("@ManyToOne({ entity: () => User, onDelete: 'CASCADE', onUpdate: 'CASCADE' })");
    });

    it('should omit the referential action when introspection found none', () => {
      const ast = new SchemaAST();
      const users = mockTableNode('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const posts = mockTableNode('posts', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'author_id', type: { category: 'integer' } },
      ]);
      ast.addTable(users);
      ast.addTable(posts);

      ast.addRelationship({
        name: 'fk_posts_users',
        type: 'ManyToOne',
        from: { table: posts, columns: [posts.columns.get('author_id')!] },
        to: { table: users, columns: [users.columns.get('id')!] },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      });

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('posts');

      expect(result!.code).toContain('@ManyToOne({ entity: () => User })');
    });

    it('should generate OneToMany relations on the inverse side', () => {
      const ast = new SchemaAST();
      const users = mockTableNode('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const posts = mockTableNode('posts', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'author_id', type: { category: 'integer' } },
      ]);
      ast.addTable(users);
      ast.addTable(posts);

      ast.addRelationship({
        name: 'fk_posts_users',
        type: 'ManyToOne',
        from: { table: posts, columns: [posts.columns.get('author_id')!] },
        to: { table: users, columns: [users.columns.get('id')!] },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('users');

      expect(result!.code).toContain('@OneToMany');
      expect(result!.code).toContain('posts?: Post[]');
    });

    it('should generate Id with custom name', () => {
      const ast = new SchemaAST();
      const table = mockTableNode('users', [{ name: 'user_id', type: { category: 'integer' }, isPrimaryKey: true }]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('users');

      expect(result!.code).toContain("@Id({ name: 'user_id' })");
    });

    it('should generate field with default value', () => {
      const ast = new SchemaAST();
      const table = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'status', type: { category: 'string' }, defaultValue: 'active' },
      ]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('users');

      expect(result!.code).toContain("defaultValue: 'active'");
    });

    it('should carry a plain single-column index on the field itself', () => {
      const ast = new SchemaAST();
      const table = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);
      ast.addTable(table);
      ast.addIndex({ name: 'idx_email', table, entries: [{ column: 'email' }], unique: false });

      const result = new EntityCodeGenerator(ast).generateForTable('users');

      expect(result!.code).toContain("index: 'idx_email'");
    });

    // `@Field({ index })` builds a plain index, so writing a unique one there would silently drop the
    // uniqueness the database has.
    it('should write a unique single-column index as its own decorator', () => {
      const ast = new SchemaAST();
      const table = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'email', type: { category: 'string' } },
      ]);
      ast.addTable(table);
      ast.addIndex({ name: 'idx_email', table, entries: [{ column: 'email' }], unique: true });

      const result = new EntityCodeGenerator(ast).generateForTable('users');

      expect(result!.code).toContain("@Index(['email'], { name: 'idx_email', unique: true })");
      expect(result!.code).not.toContain("index: 'idx_email'");
    });

    it('should generate composite index', () => {
      const ast = new SchemaAST();
      const table = mockTableNode('users', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'first_name', type: { category: 'string' } },
        { name: 'last_name', type: { category: 'string' } },
      ]);
      ast.addTable(table);
      ast.addIndex({
        name: 'idx_name',
        table,
        entries: [{ column: 'first_name' }, { column: 'last_name' }],
        unique: false,
      });

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('users');

      expect(result!.code).toContain("@Index(['firstName', 'lastName'], { name: 'idx_name' })");
      expect(result!.code).toContain('import { Entity, Field, Id, Index }');
    });

    it('should handle boolean and Date types', () => {
      const ast = new SchemaAST();
      const table = mockTableNode('test', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'is_active', type: { category: 'boolean' } },
        { name: 'created_at', type: { category: 'timestamp' } },
      ]);
      ast.addTable(table);

      const generator = new EntityCodeGenerator(ast);
      const result = generator.generateForTable('test');

      expect(result!.code).toContain('isActive?: boolean');
      expect(result!.code).toContain('createdAt?: Date');
    });

    it('should format complex default values correctly', () => {
      const ast = new SchemaAST();
      const table = mockTableNode('test', [
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

      expect(result!.code).toContain('defaultValue: {"a":1}');
      expect(result!.code).toContain('defaultValue: ["tag1"]');
      expect(result!.code).toContain('defaultValue: null');
      expect(result!.code).toContain("defaultValue: 'CURRENT_TIMESTAMP'");
      expect(result!.code).toContain('defaultValue: true');
      expect(result!.code).toContain('defaultValue: 123');
    });

    it('should handle OneToOne and ManyToMany relations', () => {
      const ast = new SchemaAST();
      const users = mockTableNode('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const profiles = mockTableNode('profiles', []);
      const tags = mockTableNode('tags', []);
      const userTags = mockTableNode('user_tags', []);

      const profileRel: any = {
        name: 'profile',
        type: 'OneToOne',
        from: { table: users, columns: [users.columns.get('id')] },
        to: { table: profiles, columns: [] },
      };

      const tagsRel: any = {
        name: 'tags',
        type: 'ManyToMany',
        from: { table: users, columns: [users.columns.get('id')!] },
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

      expect(result!.code).toContain('@OneToOne');
      expect(result!.code).toContain('@ManyToMany');
    });
  });

  describe('createEntityCodeGenerator', () => {
    it('should create an instance via factory', () => {
      const ast = new SchemaAST();
      const generator = createEntityCodeGenerator(ast);
      expect(generator).toBeInstanceOf(EntityCodeGenerator);
    });
  });

  describe('options', () => {
    /** `users` + `posts.author_id -> users.id`, plus an index and a comment to switch off. */
    function createBlogAst() {
      const ast = new SchemaAST();
      const users = mockTableNode('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const posts = mockTableNode('posts', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'author_id', type: { category: 'integer' } },
        { name: 'title', type: { category: 'string', length: 255 }, comment: 'headline', nullable: false },
      ]);
      ast.addTable(users);
      ast.addTable(posts);
      ast.addRelationship({
        name: 'fk_posts_users',
        type: 'ManyToOne',
        from: { table: posts, columns: [posts.columns.get('author_id')!] },
        to: { table: users, columns: [users.columns.get('id')!] },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });
      ast.addIndex({
        name: 'idx_posts_title',
        table: posts,
        entries: [{ column: 'title' }],
        unique: false,
      });
      return ast;
    }

    it('should return undefined for a table the schema does not have', () => {
      expect(new EntityCodeGenerator(new SchemaAST()).generateForTable('ghost')).toBeUndefined();
    });

    it('should omit relations, their imports and their decorators when disabled', () => {
      const result = new EntityCodeGenerator(createBlogAst(), { includeRelations: false }).generateForTable('posts');

      expect(result!.code).not.toContain('@ManyToOne');
      expect(result!.code).not.toContain('Relation');
      expect(result!.code).not.toContain("from './User.js'");
      expect(result!.code).toContain('authorId?: number;');
    });

    it('should omit index decorators and index field options when disabled', () => {
      const result = new EntityCodeGenerator(createBlogAst(), { includeIndexes: false }).generateForTable('posts');

      expect(result!.code).not.toContain('@Index');
      expect(result!.code).not.toContain('index:');
    });

    it('should omit the generated JSDoc when sync comments are disabled', () => {
      const result = new EntityCodeGenerator(createBlogAst(), { addSyncComments: false }).generateForTable('posts');

      expect(result!.code).not.toContain('@sync-added');
      expect(result!.code).not.toContain('/**');
    });

    it('should carry a column comment into the generated JSDoc', () => {
      const result = new EntityCodeGenerator(createBlogAst()).generateForTable('posts');

      expect(result!.code).toContain('   * headline');
    });

    it('should declare a non-nullable column as required', () => {
      const result = new EntityCodeGenerator(createBlogAst()).generateForTable('posts');

      expect(result!.code).toContain("@Field({ columnType: 'varchar', length: 255, index: 'idx_posts_title' })");
      expect(result!.code).toContain('title: string;');
    });

    it('should use a custom import path for the uql-orm imports', () => {
      const result = new EntityCodeGenerator(createBlogAst(), { uqlImportPath: '@acme/orm' }).generateForTable('posts');

      expect(result!.code).toContain("from '@acme/orm'");
    });
  });

  describe('generated details', () => {
    it('should describe the column type in the JSDoc, size and signedness included', () => {
      const ast = new SchemaAST();
      const table = mockTableNode('orders', [
        { name: 'id', type: { category: 'integer', size: 'big', unsigned: true }, isPrimaryKey: true },
        { name: 'total', type: { category: 'decimal', precision: 10, scale: 2 } },
        { name: 'ratio', type: { category: 'decimal', precision: 5 } },
      ]);
      ast.addTable(table);

      const result = new EntityCodeGenerator(ast).generateForTable('orders');

      expect(result!.code).toContain('Column: id (BIGINTEGER UNSIGNED)');
      expect(result!.code).toContain('Column: total (DECIMAL(10,2))');
      expect(result!.code).toContain('Column: ratio (DECIMAL(5))');
      expect(result!.code).toContain('precision: 10');
      expect(result!.code).toContain('scale: 2');
    });

    /** A foreign key not named `<something>id` has no base name to reuse, so the target table names it. */
    it('should name a relation after its target table when the column name has no id suffix', () => {
      const ast = new SchemaAST();
      const users = mockTableNode('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const posts = mockTableNode('posts', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'owner', type: { category: 'integer' } },
      ]);
      ast.addTable(users);
      ast.addTable(posts);
      ast.addRelationship({
        name: 'fk_posts_users',
        type: 'ManyToOne',
        from: { table: posts, columns: [posts.columns.get('owner')!] },
        to: { table: users, columns: [users.columns.get('id')!] },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      });

      const result = new EntityCodeGenerator(ast).generateForTable('posts');

      expect(result!.code).toContain('user?: User;');
    });

    /** Relations recovered by name conventions rather than a real constraint are flagged as a guess. */
    it('should note the confidence of an inferred relation', () => {
      const ast = new SchemaAST();
      const users = mockTableNode('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const posts = mockTableNode('posts', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'author_id', type: { category: 'integer' } },
      ]);
      ast.addTable(users);
      ast.addTable(posts);
      ast.addRelationship({
        name: 'inferred_posts_users',
        type: 'ManyToOne',
        from: { table: posts, columns: [posts.columns.get('author_id')!] },
        to: { table: users, columns: [users.columns.get('id')!] },
        confidence: 0.8,
      });

      const result = new EntityCodeGenerator(ast).generateForTable('posts');

      expect(result!.code).toContain('Inferred (80% confidence)');
    });

    /** The inverse of a OneToOne is a single entity, not a list. */
    it('should declare the inverse side of a OneToOne as a single relation', () => {
      const ast = new SchemaAST();
      const users = mockTableNode('users', [{ name: 'id', type: { category: 'integer' }, isPrimaryKey: true }]);
      const profiles = mockTableNode('profiles', [
        { name: 'id', type: { category: 'integer' }, isPrimaryKey: true },
        { name: 'user_id', type: { category: 'integer' }, isUnique: true },
      ]);
      ast.addTable(users);
      ast.addTable(profiles);
      ast.addRelationship({
        name: 'fk_profiles_users',
        type: 'OneToOne',
        from: { table: profiles, columns: [profiles.columns.get('user_id')!] },
        to: { table: users, columns: [users.columns.get('id')!] },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });

      const result = new EntityCodeGenerator(ast).generateForTable('users');

      expect(result!.code).toContain("@OneToOne({ entity: () => Profile, references: 'user' })");
      expect(result!.code).toContain('profiles?: Profile;');
    });

    it('should emit a bare @Index for a composite index with no name and no unique flag', () => {
      const ast = new SchemaAST();
      const table = mockTableNode('users', [
        { name: 'first_name', type: { category: 'string' } },
        { name: 'last_name', type: { category: 'string' } },
      ]);
      ast.addTable(table);
      ast.addIndex({
        name: '',
        table,
        entries: [{ column: 'first_name' }, { column: 'last_name' }],
        unique: false,
      });

      const result = new EntityCodeGenerator(ast).generateForTable('users');

      expect(result!.code).toContain("@Index(['firstName', 'lastName'])");
    });
  });
});
