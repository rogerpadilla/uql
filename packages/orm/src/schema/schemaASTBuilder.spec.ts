import { describe, expect, it } from 'vitest';
import { Entity, Field, Id, Index, ManyToOne, OneToMany, OneToOne } from '../entity/index.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { assertDefined } from '../test/index.js';
import { idKey } from '../type/index.js';
import type { NamingStrategy } from '../type/namingStrategy.js';
import { raw } from '../util/index.js';
import { buildSchemaAST } from './schemaASTBuilder.js';

// Test entities
@Entity()
class User {
  @Id({ type: Number })
  id?: number;

  @Field({ type: String })
  name?: string | null;

  @Field({ type: String, nullable: true })
  email?: string | null;

  @OneToMany({ entity: () => Post, mappedBy: (post) => post.author })
  posts?: Post[];
}

@Entity()
class Post {
  @Id({ type: Number })
  id?: number;

  @Field({ type: String })
  title?: string | null;

  @Field({ type: 'text' })
  content?: string | null;

  @ManyToOne({ entity: () => User, references: (post) => post.authorId })
  author?: User;

  @Field({ type: Number, name: 'author_id' })
  authorId?: number | null;
}

@Entity({ name: 'categories' })
class Category {
  @Id({ type: Number })
  id?: number;

  @Field({ type: String, unique: true })
  slug?: string | null;

  @Field({ type: String, length: 100 })
  name?: string | null;
}

describe('SchemaASTBuilder', () => {
  describe('fromEntities', () => {
    it('should build AST from a single entity', () => {
      const ast = buildSchemaAST([User]);

      expect(ast.tables.size).toBe(1);
      const userTable = ast.getTable('User');
      expect(userTable).toBeDefined();
      expect(userTable?.columns.size).toBeGreaterThan(0);
    });

    it('should build AST from multiple entities', () => {
      const ast = buildSchemaAST([User, Post, Category]);

      expect(ast.tables.size).toBe(3);
      expect(ast.getTable('User')).toBeDefined();
      expect(ast.getTable('Post')).toBeDefined();
      expect(ast.getTable('categories')).toBeDefined();
    });

    it('should create columns with correct types', () => {
      const ast = buildSchemaAST([User]);

      const userTable = ast.getTable('User');
      const idCol = userTable?.columns.get('id');
      const nameCol = userTable?.columns.get('name');

      expect(idCol?.type.category).toBe('integer');
      expect(idCol?.isPrimaryKey).toBe(true);
      expect(nameCol?.type.category).toBe('string');
    });

    it('should infer a FK field type from its referenced entity primary key when no type is given', () => {
      @Entity()
      class Account {
        @Id({ type: 'uuid' })
        id?: string;
      }
      @Entity()
      class Item {
        @Id({ type: 'uuid' })
        id?: string;
        // No explicit type/columnType - should inherit 'uuid' from Account.id,
        // not fall back to the generic TypeScript-inferred 'string' (TEXT).
        @Field({ references: () => Account })
        accountId?: string | null;
      }

      const ast = buildSchemaAST([Account, Item]);

      const itemTable = ast.getTable('Item');
      const accountIdCol = itemTable?.columns.get('accountId');

      expect(accountIdCol?.type.category).toBe('uuid');
    });

    it('should still respect an explicit type on a FK field over the referenced entity', () => {
      @Entity()
      class Parent2 {
        @Id({ type: 'uuid' })
        id?: string;
      }
      @Entity()
      class Child2 {
        @Id({ type: Number }) id?: number;
        @Field({ references: () => Parent2, type: 'text' })
        parentRef?: string | null;
      }

      const ast = buildSchemaAST([Parent2, Child2]);

      const childTable = ast.getTable('Child2');
      const col = childTable?.columns.get('parentRef');

      expect(col?.type.category).toBe('string');
    });

    it("should emit a relation's own onDelete/onUpdate over the global default", () => {
      @Entity()
      class FkParent {
        @Id({ type: Number }) id?: number;
        @OneToMany({ entity: () => FkChild, mappedBy: (fkChild) => fkChild.parent }) children?: FkChild[];
      }
      @Entity()
      class FkChild {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number, references: () => FkParent }) parentId?: number | null;
        // The action lives on the owning side, which is the side that holds the key.
        @ManyToOne({
          entity: () => FkParent,
          references: (fkChild) => fkChild.parentId,
          onDelete: 'CASCADE',
          onUpdate: 'RESTRICT',
        })
        parent?: FkParent;
      }
      @Entity()
      class PlainChild {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number, references: () => FkParent }) parentId?: number | null;
        @ManyToOne({ entity: () => FkParent, references: (plainChild) => plainChild.parentId }) parent?: FkParent;
      }

      const ast = buildSchemaAST([FkParent, FkChild, PlainChild]);

      const declared = ast.getTable('FkChild')?.outgoingRelations[0];
      expect(declared?.onDelete).toBe('CASCADE');
      expect(declared?.onUpdate).toBe('RESTRICT');

      // A relation that declares nothing keeps the default, so one relation cascading does not drag
      // the rest of the schema with it.
      const untouched = ast.getTable('PlainChild')?.outgoingRelations[0];
      expect(untouched?.onDelete).toBe('NO ACTION');
      expect(untouched?.onUpdate).toBe('NO ACTION');
    });

    it("should fall back to the FK field's own onDelete when no relation sets one", () => {
      @Entity()
      class FkOnFieldParent {
        @Id({ type: Number }) id?: number;
      }
      // No @ManyToOne at all: a bare FK field is a foreign key of its own, and still takes its cascade.
      @Entity()
      class FkOnFieldOnlyChild {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number, references: () => FkOnFieldParent, onDelete: 'CASCADE' }) parentId?: number | null;
      }
      // A declared relation with no onDelete of its own inherits the field's, so the two never drift.
      @Entity()
      class FkOnFieldWithRelationChild {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number, references: () => FkOnFieldParent, onDelete: 'CASCADE' }) parentId?: number | null;
        @ManyToOne({ entity: () => FkOnFieldParent, references: (child) => child.parentId }) parent?: FkOnFieldParent;
      }
      // The relation's own onDelete still wins over a disagreeing field.
      @Entity()
      class FkOnFieldOverriddenChild {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number, references: () => FkOnFieldParent, onDelete: 'CASCADE' }) parentId?: number | null;
        @ManyToOne({ entity: () => FkOnFieldParent, references: (child) => child.parentId, onDelete: 'SET NULL' })
        parent?: FkOnFieldParent;
      }

      const ast = buildSchemaAST([
        FkOnFieldParent,
        FkOnFieldOnlyChild,
        FkOnFieldWithRelationChild,
        FkOnFieldOverriddenChild,
      ]);

      expect(ast.getTable('FkOnFieldOnlyChild')?.outgoingRelations[0]?.onDelete).toBe('CASCADE');
      expect(ast.getTable('FkOnFieldWithRelationChild')?.outgoingRelations[0]?.onDelete).toBe('CASCADE');
      expect(ast.getTable('FkOnFieldOverriddenChild')?.outgoingRelations[0]?.onDelete).toBe('SET NULL');
    });

    it('should respect an explicit constructor type (e.g. BigInt) on a FK field over the referenced entity', () => {
      @Entity()
      class Parent3 {
        @Id({ type: 'uuid' })
        id?: string;
      }
      @Entity()
      class Child3 {
        @Id({ type: Number }) id?: number;
        // An explicit `type` must win over resolving the column from `references`, which would
        // otherwise inherit 'uuid' from Parent3.id.
        @Field({ references: () => Parent3, type: BigInt })
        parentRef?: bigint | null;
      }

      const ast = buildSchemaAST([Parent3, Child3]);

      const childTable = ast.getTable('Child3');
      const col = childTable?.columns.get('parentRef');

      expect(col?.type.category).toBe('integer');
      expect(col?.type.size).toBe('big');
    });

    it('should handle nullable fields', () => {
      const ast = buildSchemaAST([User]);

      const userTable = ast.getTable('User');
      const emailCol = userTable?.columns.get('email');

      expect(emailCol?.nullable).toBe(true);
    });

    it('should handle unique constraints', () => {
      const ast = buildSchemaAST([Category]);

      const catTable = ast.getTable('categories');
      const slugCol = catTable?.columns.get('slug');

      expect(slugCol?.isUnique).toBe(true);
    });

    it('should handle field length', () => {
      const ast = buildSchemaAST([Category]);

      const catTable = ast.getTable('categories');
      const nameCol = catTable?.columns.get('name');

      expect(nameCol?.type.length).toBe(100);
    });

    it('should detect relationships from decorators', () => {
      const ast = buildSchemaAST([User, Post]);

      expect(ast.relationships.length).toBeGreaterThan(0);
    });

    it('should handle OneToOne owning side', () => {
      @Entity()
      class Profile11 {
        @Id({ type: Number }) id?: number;
      }
      @Entity()
      class User11 {
        @Id({ type: Number }) id?: number;
        @OneToOne({
          entity: () => Profile11,
          references: (user11, profile11) => [{ local: user11.profileId, foreign: profile11.id }],
        })
        profile?: Profile11;
        @Field({ type: Number }) profileId?: number | null;
      }

      const ast = buildSchemaAST([Profile11, User11]);
      const rel = ast.relationships.find((r) => r.from.table.name === 'User11');
      expect(rel?.type).toBe('OneToOne');
    });

    it('should resolve include columns through the naming strategy too', () => {
      @Index((covered) => [covered.tenantId], { include: (covered) => [covered.createdAt], name: 'cov_idx' })
      @Entity()
      class Covered {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number, name: 'tenant_id' }) tenantId?: number | null;
        @Field({ type: Date, name: 'created_at' }) createdAt?: Date | null;
      }

      const ast = buildSchemaAST([Covered]);
      const index = ast.getTable('Covered')?.indexes[0];

      expect(index?.entries.map((entry) => entry.column)).toEqual(['tenant_id']);
      expect(index?.include).toEqual(['created_at']);
    });

    it('should use the naming strategy it was given', () => {
      const namingStrategy: NamingStrategy = {
        tableName: (name) => `tb_${name}`,
        columnName: (name) => `col_${name}`,
        joinTableName: (source, target) => `tb_${source}_${target}`,
      };

      const ast = buildSchemaAST([User, Category], { namingStrategy });

      // User -> namingStrategy(User) -> tb_User
      expect(ast.getTable('tb_User')).toBeDefined();
      expect(ast.getTable('tb_User')?.columns.has('col_id')).toBe(true);

      // Category -> namingStrategy(categories) -> tb_categories
      expect(ast.getTable('tb_categories')).toBeDefined();
    });

    it('should use custom naming strategy options overriding constructor', () => {
      const ast = buildSchemaAST([User], {
        resolveTableName: (meta) => `tbl_${(meta.name ?? meta.entity.name).toLowerCase()}`,
        resolveColumnName: (key) => `col_${key}`,
      });

      expect(ast.getTable('tbl_user')).toBeDefined();
      const userTable = ast.getTable('tbl_user');
      expect(userTable?.columns.has('col_id')).toBe(true);
    });

    it('should skip inlined computed fields', () => {
      @Entity()
      class ComputedUser {
        @Id({ type: Number }) id?: number;
        @Field({ type: String, computed: raw`TRUE` }) secret?: string | null;
      }
      const ast = buildSchemaAST([ComputedUser]);
      expect(ast.getTable('ComputedUser')?.columns.has('secret')).toBe(false);
    });

    it('should handle composite indexes and full metadata from decorators', () => {
      @Entity()
      @Index((indexedUser) => [indexedUser.firstName, indexedUser.lastName], {
        name: 'fullname_idx',
        unique: true,
        where: { active: true },
      })
      class IndexedUser {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) firstName?: string | null;
        @Field({ type: String }) lastName?: string | null;
        @Field({ type: Boolean }) active?: boolean | null;
      }

      const ast = buildSchemaAST([IndexedUser], {
        compileDdl: (sql, entity) => new PostgresDialect().compileDdl(sql, entity),
      });
      const table = ast.getTable('IndexedUser');

      const compositeIdx = table?.indexes.find((idx) => idx.entries.length > 1);
      expect(compositeIdx).toBeDefined();
      expect(compositeIdx?.name).toBe('fullname_idx');
      expect(compositeIdx?.unique).toBe(true);
      expect(compositeIdx?.where).toBe('"active" = true');
      expect(compositeIdx?.entries.map((entry) => entry.column)).toEqual(['firstName', 'lastName']);
    });

    it('should refuse SQL an entity declares when given nothing to render it with', () => {
      @Entity({ checks: [{ where: raw`1 = 1` }] })
      class Checked {
        @Id({ type: Number }) id?: number;
      }
      expect(() => buildSchemaAST([Checked])).toThrow(/needs a dialect/);
    });

    it('should ignore composite index if columns do not exist', () => {
      @Entity()
      // @ts-expect-error the column names are checked against the class, so this is the runtime backstop
      // behind a compile error rather than something a user can reach by writing valid TypeScript.
      @Index((badComposite) => [badComposite.unknown])
      class BadComposite {
        @Id({ type: Number }) id?: number;
      }
      const ast = buildSchemaAST([BadComposite]);
      expect(ast.getTable('BadComposite')?.indexes.length).toBe(0);
    });
  });

  /**
   * A relation looks its rows up by the foreign key, and only MySQL indexes one on its own: without an
   * index, reading a page's children scans the whole child table once per parent.
   */
  describe('foreign key indexes', () => {
    @Entity()
    class FkBlog {
      @Id({ type: Number }) id?: number;
    }

    @Entity()
    class FkTag {
      @Id({ type: Number }) id?: number;
    }

    const indexedColumns = (ast: ReturnType<typeof buildSchemaAST>, table: string) =>
      ast.getTable(table)?.indexes.map((index) => index.entries.map((entry) => entry.column));

    it('should index a foreign key the entity does not index itself', () => {
      @Entity()
      class FkPost {
        @Id({ type: Number }) id?: number;
        @Field({ references: () => FkBlog }) fkBlogId?: number | null;
      }

      expect(buildSchemaAST([FkBlog, FkPost]).getTable('FkPost')?.indexes).toMatchObject([
        { name: 'FkPost__fkBlogId_idx', unique: false, entries: [{ column: 'fkBlogId' }] },
      ]);
    });

    it('should index every column of a composite foreign key, in order', () => {
      @Entity()
      class FkRegion {
        [idKey]?: 'country' | 'area';
        @Id({ type: String }) country?: string;
        @Id({ type: String }) area?: string;
      }

      @Entity()
      class FkCity {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) cityCountry?: string | null;
        @Field({ type: String }) cityArea?: string | null;
        @ManyToOne({
          entity: () => FkRegion,
          references: (fkCity, fkRegion) => [
            { local: fkCity.cityCountry, foreign: fkRegion.country },
            { local: fkCity.cityArea, foreign: fkRegion.area },
          ],
        })
        region?: FkRegion;
      }

      expect(indexedColumns(buildSchemaAST([FkRegion, FkCity]), 'FkCity')).toEqual([['cityCountry', 'cityArea']]);
    });

    it('should not index a foreign key again under an index the entity declares', () => {
      @Entity()
      @Index((fkLeading) => [fkLeading.fkBlogId, fkLeading.title])
      class FkLeading {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) title?: string | null;
        @Field({ references: () => FkBlog }) fkBlogId?: number | null;
      }

      @Entity()
      class FkFieldIndexed {
        @Id({ type: Number }) id?: number;
        @Field({ references: () => FkBlog, index: 'by_blog' }) fkBlogId?: number | null;
      }

      const ast = buildSchemaAST([FkBlog, FkLeading, FkFieldIndexed]);

      expect(indexedColumns(ast, 'FkLeading')).toEqual([['fkBlogId', 'title']]);
      expect(indexedColumns(ast, 'FkFieldIndexed')).toEqual([['fkBlogId']]);
    });

    it('should not index a foreign key the primary key or a unique constraint already leads with', () => {
      @Entity()
      class FkBlogTag {
        [idKey]?: 'fkBlogId' | 'fkTagId';
        @Id({ type: Number, references: () => FkBlog }) fkBlogId?: number;
        @Id({ type: Number, references: () => FkTag }) fkTagId?: number;
      }

      @Entity()
      class FkBlogOwner {
        @Id({ type: Number }) id?: number;
        @Field({ references: () => FkBlog, unique: true }) fkBlogId?: number | null;
      }

      const ast = buildSchemaAST([FkBlog, FkTag, FkBlogTag, FkBlogOwner]);

      // The key leads with its first column alone, so the second still needs an index of its own.
      expect(indexedColumns(ast, 'FkBlogTag')).toEqual([['fkTagId']]);
      expect(indexedColumns(ast, 'FkBlogOwner')).toEqual([]);
    });

    it('should leave a foreign key unindexed when its field opts out', () => {
      @Entity()
      class FkUnindexed {
        @Id({ type: Number }) id?: number;
        @Field({ references: () => FkBlog, index: false }) fkBlogId?: number | null;
      }

      expect(indexedColumns(buildSchemaAST([FkBlog, FkUnindexed]), 'FkUnindexed')).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should keep an include column that names no field as written', () => {
      @Entity()
      // Outside the types, which name a field; a column the entity does not model still reaches the DDL.
      // @ts-expect-error: a column the entity does not model
      @Index((covering) => [covering.tenantId], { include: (covering) => [covering['legacy_total']] })
      class Covering {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number }) tenantId?: number | null;
      }
      const table = buildSchemaAST([Covering]).getTable('Covering');
      assertDefined(table);
      const [index] = table.indexes;
      expect(index.include).toEqual(['legacy_total']);
    });

    /** A resolver answering differently on each call names a column the table has not got. */
    it('should skip an index on a column the table has not got', () => {
      @Entity()
      class RenamedColumn {
        @Id({ type: Number }) id?: number;
        @Field({ type: String, index: true }) name?: string | null;
      }

      let callCount = 0;
      const ast = buildSchemaAST([RenamedColumn], { resolveColumnName: () => `c${++callCount}` });

      expect(ast.getTable('RenamedColumn')?.indexes).toEqual([]);
    });

    /** A resolver answering differently on each call looks the relation's table up under another name. */
    it('should skip a relation whose table it cannot find', () => {
      @Entity()
      class Unstable {
        @Id({ type: Number }) id?: number;
        @Field({ references: () => Unstable }) selfId?: number | null;
        @ManyToOne({ entity: () => Unstable, references: (unstable) => unstable.selfId }) self?: Unstable;
      }

      let callCount = 0;
      const ast = buildSchemaAST([Unstable], { resolveTableName: () => `T${++callCount}` });

      expect(ast.tables.size).toBe(1);
      expect(ast.relationships).toEqual([]);
    });

    it('should make an integer key auto-increment unless it says otherwise', () => {
      @Entity()
      class AutoInc {
        @Id({ type: Number }) id?: number;
      }
      @Entity()
      class NoAutoInc {
        @Id({ type: Number, autoIncrement: false }) id?: number;
      }

      const ast = buildSchemaAST([AutoInc, NoAutoInc]);

      expect(ast.getTable('AutoInc')?.columns.get('id')?.isAutoIncrement).toBe(true);
      expect(ast.getTable('NoAutoInc')?.columns.get('id')?.isAutoIncrement).toBe(false);
    });

    it('should name an index declared as `true` after its table and column', () => {
      @Entity()
      class DefaultIndex {
        @Id({ type: Number }) id?: number;
        @Field({ type: String, index: true }) name?: string | null;
      }

      expect(buildSchemaAST([DefaultIndex]).getTable('DefaultIndex')?.indexes[0].name).toBe('DefaultIndex__name_idx');
    });

    it('should relate a to-one through the column its references name, to the key of its target', () => {
      @Entity()
      class Target {
        @Id({ type: Number }) id?: number;
      }
      @Entity()
      class Source {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number }) targetId?: number | null;
        @ManyToOne({ entity: () => Target, references: (source) => source.targetId }) target?: Target;
      }
      @Entity()
      class Member {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number }) groupIdKey?: number | null;
        @ManyToOne({
          entity: () => Target,
          references: (member, target) => [{ local: member.groupIdKey, foreign: target.id }],
        })
        group?: Target;
      }

      const ast = buildSchemaAST([Target, Source, Member]);
      const columnsOf = (table: string) =>
        ast.relationships
          .filter((rel) => rel.from.table.name === table)
          .map((rel) => [rel.from.columns[0].name, rel.to.columns[0].name]);

      expect(columnsOf('Source')).toEqual([['targetId', 'id']]);
      expect(columnsOf('Member')).toEqual([['groupIdKey', 'id']]);
    });

    it('should use custom index name from entity', () => {
      @Entity()
      class CustomIndex {
        @Id({ type: Number }) id?: number;
        @Field({ type: String, index: 'my_custom_idx' }) name?: string | null;
      }
      const ast = buildSchemaAST([CustomIndex]);
      expect(ast.getTable('CustomIndex')?.indexes[0].name).toBe('my_custom_idx');
    });

    it('should use default callback when resolveTableName/resolveColumnName are not provided', () => {
      const ast = buildSchemaAST([User]);
      const table = ast.getTable('User');
      expect(table).toBeDefined();
      expect(table?.name).toBe('User');
      expect(table?.columns.get('name')).toBeDefined();
    });
  });

  it('should build a schema of its own each time, sharing nothing with the last', () => {
    const first = buildSchemaAST([User]);
    const second = buildSchemaAST([]);

    expect(first.tables.size).toBe(1);
    expect(second.tables.size).toBe(0);
  });
});
