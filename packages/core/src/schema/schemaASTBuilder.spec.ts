import { describe, expect, it } from 'vitest';
import { Entity, Field, getMeta, Id, ManyToOne, OneToMany, OneToOne } from '../entity/index.js';
import { raw } from '../util/index.js';
import { SchemaASTBuilder } from './schemaASTBuilder.js';

// Test entities
@Entity()
class User {
  @Id()
  id?: number;

  @Field()
  name?: string;

  @Field({ nullable: true })
  email?: string;

  @OneToMany({ entity: () => Post, mappedBy: 'author' })
  posts?: Post[];
}

@Entity()
class Post {
  @Id()
  id?: number;

  @Field()
  title?: string;

  @Field({ type: 'text' })
  content?: string;

  @ManyToOne({ entity: () => User })
  author?: User;

  @Field({ name: 'author_id' })
  authorId?: number;
}

@Entity({ name: 'categories' })
class Category {
  @Id()
  id?: number;

  @Field({ unique: true })
  slug?: string;

  @Field({ length: 100 })
  name?: string;
}

describe('SchemaASTBuilder', () => {
  describe('fromEntities', () => {
    it('should build AST from a single entity', () => {
      const builder = new SchemaASTBuilder();
      const ast = builder.fromEntities([User]);

      expect(ast.tables.size).toBe(1);
      const userTable = ast.getTable('User');
      expect(userTable).toBeDefined();
      expect(userTable?.columns.size).toBeGreaterThan(0);
    });

    it('should build AST from multiple entities', () => {
      const builder = new SchemaASTBuilder();
      const ast = builder.fromEntities([User, Post, Category]);

      expect(ast.tables.size).toBe(3);
      expect(ast.getTable('User')).toBeDefined();
      expect(ast.getTable('Post')).toBeDefined();
      expect(ast.getTable('categories')).toBeDefined();
    });

    it('should create columns with correct types', () => {
      const builder = new SchemaASTBuilder();
      const ast = builder.fromEntities([User]);

      const userTable = ast.getTable('User');
      const idCol = userTable?.columns.get('id');
      const nameCol = userTable?.columns.get('name');

      expect(idCol?.type.category).toBe('integer');
      expect(idCol?.isPrimaryKey).toBe(true);
      expect(nameCol?.type.category).toBe('string');
    });

    it('should handle nullable fields', () => {
      const builder = new SchemaASTBuilder();
      const ast = builder.fromEntities([User]);

      const userTable = ast.getTable('User');
      const emailCol = userTable?.columns.get('email');

      expect(emailCol?.nullable).toBe(true);
    });

    it('should handle unique constraints', () => {
      const builder = new SchemaASTBuilder();
      const ast = builder.fromEntities([Category]);

      const catTable = ast.getTable('categories');
      const slugCol = catTable?.columns.get('slug');

      expect(slugCol?.isUnique).toBe(true);
    });

    it('should handle field length', () => {
      const builder = new SchemaASTBuilder();
      const ast = builder.fromEntities([Category]);

      const catTable = ast.getTable('categories');
      const nameCol = catTable?.columns.get('name');

      expect(nameCol?.type.length).toBe(100);
    });

    it('should detect relationships from decorators', () => {
      const builder = new SchemaASTBuilder();
      const ast = builder.fromEntities([User, Post]);

      expect(ast.relationships.length).toBeGreaterThan(0);
    });

    it('should handle OneToOne owning side', () => {
      @Entity()
      class Profile11 {
        @Id() id?: number;
      }
      @Entity()
      class User11 {
        @Id() id?: number;
        @OneToOne({ entity: () => Profile11, references: [{ local: 'profileId', foreign: 'id' }] })
        profile?: Profile11;
        @Field() profileId?: number;
      }

      const builder = new SchemaASTBuilder();
      const ast = builder.fromEntities([Profile11, User11]);
      const rel = ast.relationships.find((r) => r.from.table.name === 'User11');
      expect(rel?.type).toBe('OneToOne');
    });

    it('should use custom naming strategy via constructor', () => {
      const ns = {
        tableName: (name: string) => `tb_${name}`,
        columnName: (name: string) => `col_${name}`,
      } as any;
      const builder = new SchemaASTBuilder(ns);

      const ast = builder.fromEntities([User, Category]);

      // User -> namingStrategy(User) -> tb_User
      expect(ast.getTable('tb_User')).toBeDefined();
      expect(ast.getTable('tb_User')?.columns.has('col_id')).toBe(true);

      // Category -> namingStrategy(categories) -> tb_categories
      expect(ast.getTable('tb_categories')).toBeDefined();
    });

    it('should use custom naming strategy options overriding constructor', () => {
      const builder = new SchemaASTBuilder();
      const ast = builder.fromEntities([User], {
        resolveTableName: (_entity, meta) => `tbl_${meta.name?.toLowerCase() ?? _entity.name.toLowerCase()}`,
        resolveColumnName: (key) => `col_${key}`,
      });

      expect(ast.getTable('tbl_user')).toBeDefined();
      const userTable = ast.getTable('tbl_user');
      expect(userTable?.columns.has('col_id')).toBe(true);
    });

    it('should skip virtual fields', () => {
      @Entity()
      class VirtualUser {
        @Id() id?: number;
        @Field({ virtual: raw('TRUE') }) secret?: string;
      }
      const builder = new SchemaASTBuilder();
      const ast = builder.fromEntities([VirtualUser]);
      expect(ast.getTable('VirtualUser')?.columns.has('secret')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle OneToOne with missing local field', () => {
      @Entity()
      class Related {
        @Id() id?: number;
      }
      @Entity()
      class Owner {
        @Id() id?: number;
        @OneToOne({ entity: () => Related, references: [{ local: 'nonExistent', foreign: 'id' }] })
        related?: Related;
      }

      const builder = new SchemaASTBuilder();
      const ast = builder.fromEntities([Related, Owner]);
      expect(ast.relationships.length).toBe(0);
    });

    it('should skip indexing non-existent columns from entity', () => {
      @Entity()
      class BadIndex {
        @Id() id?: number;
      }
      const meta = getMeta(BadIndex);
      (meta.fields as Record<string, any>).no_col = { index: true, name: 'no_col', virtual: true }; // Inject a field that wasn't properly added

      const builder = new SchemaASTBuilder();
      const ast = builder.fromEntities([BadIndex]);
      expect(ast.getTable('BadIndex')?.indexes.length).toBe(0);
    });

    it('should use custom index name from entity', () => {
      @Entity()
      class CustomIndex {
        @Id() id?: number;
        @Field({ index: 'my_custom_idx' }) name?: string;
      }
      const builder = new SchemaASTBuilder();
      const ast = builder.fromEntities([CustomIndex]);
      expect(ast.getTable('CustomIndex')?.indexes[0].name).toBe('my_custom_idx');
    });
  });

  describe('reset', () => {
    it('should reset builder state', () => {
      const builder = new SchemaASTBuilder();
      builder.fromEntities([User]);

      builder.reset();
      expect(builder.getAST().tables.size).toBe(0);
    });

    it('should return AST via getAST', () => {
      const builder = new SchemaASTBuilder();
      const ast = builder.fromEntities([User]);
      expect(builder.getAST()).toBe(ast);
    });
  });
});
