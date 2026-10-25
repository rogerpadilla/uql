import { describe, expect, it } from 'vitest';
import { Computed, Entity, f, Field, ManyToOne, OneToMany, OneToOne } from '../entity/index.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { assertDefined } from '../test/index.js';
import { idKey } from '../type/index.js';
import { sql } from '../util/index.js';
import { buildSchemaAST } from './schemaASTBuilder.js';

// Test entities
@Entity()
class User {
  @Field(f.number().id())
  id?: number;

  @Field(f.string().nullable())
  name?: string | null;

  @Field(f.string().nullable())
  email?: string | null;

  @OneToMany({ entity: () => Post, mappedBy: (post) => post.author })
  posts?: Post[];
}

@Entity()
class Post {
  @Field(f.number().id())
  id?: number;

  @Field(f.string().nullable())
  title?: string | null;

  @Field(f.text().nullable())
  content?: string | null;

  @ManyToOne({ entity: () => User, references: (post) => post.authorId })
  author?: User;

  @Field(f.number().nullable().name('author_id'))
  authorId?: number | null;
}

@Entity({ name: 'categories' })
class Category {
  @Field(f.number().id())
  id?: number;

  @Field(f.string().nullable().unique())
  slug?: string | null;

  @Field(f.string().nullable().length(100))
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
        @Field(f.uuid().id())
        id?: string;
      }
      @Entity()
      class Item {
        @Field(f.uuid().id())
        id?: string;
        // No explicit type/columnType - should inherit 'uuid' from Account.id,
        // not fall back to the generic TypeScript-inferred 'string' (TEXT).
        @Field(f.references(() => Account).nullable())
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
        @Field(f.uuid().id())
        id?: string;
      }
      @Entity()
      class Child2 {
        @Field(f.number().id()) id?: number;
        @Field(
          f
            .text()
            .nullable()
            .references(() => Parent2),
        )
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
        @Field(f.number().id()) id?: number;
        @OneToMany({ entity: () => FkChild, mappedBy: (fkChild) => fkChild.parent }) children?: FkChild[];
      }
      @Entity()
      class FkChild {
        @Field(f.number().id()) id?: number;
        @Field(
          f
            .number()
            .nullable()
            .references(() => FkParent),
        )
        parentId?: number | null;
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
        @Field(f.number().id()) id?: number;
        @Field(
          f
            .number()
            .nullable()
            .references(() => FkParent),
        )
        parentId?: number | null;
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
        @Field(f.number().id()) id?: number;
      }
      // No @ManyToOne at all: a bare FK field is a foreign key of its own, and still takes its cascade.
      @Entity()
      class FkOnFieldOnlyChild {
        @Field(f.number().id()) id?: number;
        @Field(
          f
            .number()
            .nullable()
            .references(() => FkOnFieldParent)
            .onDelete('CASCADE'),
        )
        parentId?: number | null;
      }
      // A declared relation with no onDelete of its own inherits the field's, so the two never drift.
      @Entity()
      class FkOnFieldWithRelationChild {
        @Field(f.number().id()) id?: number;
        @Field(
          f
            .number()
            .nullable()
            .references(() => FkOnFieldParent)
            .onDelete('CASCADE'),
        )
        parentId?: number | null;
        @ManyToOne({ entity: () => FkOnFieldParent, references: (child) => child.parentId }) parent?: FkOnFieldParent;
      }
      // The relation's own onDelete still wins over a disagreeing field.
      @Entity()
      class FkOnFieldOverriddenChild {
        @Field(f.number().id()) id?: number;
        @Field(
          f
            .number()
            .nullable()
            .references(() => FkOnFieldParent)
            .onDelete('CASCADE'),
        )
        parentId?: number | null;
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
        @Field(f.column('int').id())
        id?: number;
      }
      @Entity()
      class Child3 {
        @Field(f.number().id()) id?: number;
        // An explicit `type` must win over resolving the column from `references`, which would
        // otherwise inherit 'int' from Parent3.id.
        @Field(
          f
            .bigint()
            .nullable()
            .references(() => Parent3),
        )
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
        @Field(f.number().id()) id?: number;
      }
      @Entity()
      class User11 {
        @Field(f.number().id()) id?: number;
        @OneToOne({
          entity: () => Profile11,
          references: (user11, profile11) => [{ local: user11.profileId, foreign: profile11.id }],
        })
        profile?: Profile11;
        @Field(f.number().nullable()) profileId?: number | null;
      }

      const ast = buildSchemaAST([Profile11, User11]);
      const rel = ast.relationships.find((r) => r.from.table.name === 'User11');
      expect(rel?.type).toBe('OneToOne');
    });

    it('should resolve include columns through the naming strategy too', () => {
      @Entity({
        indexes: (covered, index) => [index([covered.tenantId], { include: [covered.createdAt], name: 'cov_idx' })],
      })
      class Covered {
        @Field(f.number().id()) id?: number;
        @Field(f.number().nullable().name('tenant_id')) tenantId?: number | null;
        @Field(f.date().nullable().name('created_at')) createdAt?: Date | null;
      }

      const ast = buildSchemaAST([Covered]);
      const index = ast.getTable('Covered')?.indexes[0];

      expect(index?.entries.map((entry) => entry.column)).toEqual(['tenant_id']);
      expect(index?.include).toEqual(['created_at']);
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
        @Field(f.number().id()) id?: number;
        @Computed((row) =>
          f
            .string()
            .nullable()
            .as(sql`TRUE`),
        )
        secret?: string | null;
      }
      const ast = buildSchemaAST([ComputedUser]);
      expect(ast.getTable('ComputedUser')?.columns.has('secret')).toBe(false);
    });

    it('should handle composite indexes and full metadata from decorators', () => {
      @Entity({
        indexes: (indexedUser, index) => [
          index([indexedUser.firstName, indexedUser.lastName], {
            name: 'fullname_idx',
            unique: true,
            where: { active: true },
          }),
        ],
      })
      class IndexedUser {
        @Field(f.number().id()) id?: number;
        @Field(f.string().nullable()) firstName?: string | null;
        @Field(f.string().nullable()) lastName?: string | null;
        @Field(f.boolean().nullable()) active?: boolean | null;
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
      @Entity({ checks: (checked, check) => [check(sql`1 = 1`)] })
      class Checked {
        @Field(f.number().id()) id?: number;
      }
      expect(() => buildSchemaAST([Checked])).toThrow(/needs a dialect/);
    });

    it('should ignore composite index if columns do not exist', () => {
      @Entity({
        indexes: (badComposite, index) => [
          // @ts-expect-error the column names are checked against the class, so this is the runtime backstop
          // behind a compile error rather than something a user can reach by writing valid TypeScript.
          index([badComposite.unknown]),
        ],
      })
      class BadComposite {
        @Field(f.number().id()) id?: number;
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
      @Field(f.number().id()) id?: number;
    }

    @Entity()
    class FkTag {
      @Field(f.number().id()) id?: number;
    }

    const indexedColumns = (ast: ReturnType<typeof buildSchemaAST>, table: string) =>
      ast.getTable(table)?.indexes.map((index) => index.entries.map((entry) => entry.column ?? entry.expression));

    it('should index a foreign key the entity does not index itself', () => {
      @Entity()
      class FkPost {
        @Field(f.number().id()) id?: number;
        @Field(f.references(() => FkBlog).nullable()) fkBlogId?: number | null;
      }

      expect(buildSchemaAST([FkBlog, FkPost]).getTable('FkPost')?.indexes).toMatchObject([
        { name: 'FkPost__fkBlogId_idx', unique: false, entries: [{ column: 'fkBlogId' }] },
      ]);
    });

    it('should index every column of a composite foreign key, in order', () => {
      @Entity()
      class FkRegion {
        [idKey]?: 'country' | 'area';
        @Field(f.string().id()) country?: string;
        @Field(f.string().id()) area?: string;
      }

      @Entity()
      class FkCity {
        @Field(f.number().id()) id?: number;
        @Field(f.string().nullable()) cityCountry?: string | null;
        @Field(f.string().nullable()) cityArea?: string | null;
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
      @Entity({ indexes: (fkLeading, index) => [index([fkLeading.fkBlogId, fkLeading.title])] })
      class FkLeading {
        @Field(f.number().id()) id?: number;
        @Field(f.string().nullable()) title?: string | null;
        @Field(f.references(() => FkBlog).nullable()) fkBlogId?: number | null;
      }

      @Entity()
      class FkFieldIndexed {
        @Field(f.number().id()) id?: number;
        @Field(
          f
            .references(() => FkBlog)
            .nullable()
            .index('by_blog'),
        )
        fkBlogId?: number | null;
      }

      const ast = buildSchemaAST([FkBlog, FkLeading, FkFieldIndexed]);

      expect(indexedColumns(ast, 'FkLeading')).toEqual([['fkBlogId', 'title']]);
      expect(indexedColumns(ast, 'FkFieldIndexed')).toEqual([['fkBlogId']]);
    });

    it('should not index a foreign key the primary key or a unique column already leads with', () => {
      @Entity()
      class FkBlogTag {
        [idKey]?: 'fkBlogId' | 'fkTagId';
        @Field(
          f
            .number()
            .id()
            .references(() => FkBlog),
        )
        fkBlogId?: number;
        @Field(
          f
            .number()
            .id()
            .references(() => FkTag),
        )
        fkTagId?: number;
      }

      @Entity()
      class FkBlogOwner {
        @Field(f.number().id()) id?: number;
        @Field(
          f
            .references(() => FkBlog)
            .nullable()
            .unique(),
        )
        fkBlogId?: number | null;
      }

      const ast = buildSchemaAST([FkBlog, FkTag, FkBlogTag, FkBlogOwner]);

      // The key leads with its first column alone, so the second still needs an index of its own. A
      // unique column is its own unique index, which serves the key.
      expect(indexedColumns(ast, 'FkBlogTag')).toEqual([['fkTagId']]);
      expect(ast.getTable('FkBlogOwner')?.indexes.map(({ name, unique }) => ({ name, unique }))).toEqual([
        { name: 'FkBlogOwner__fkBlogId_idx', unique: true },
      ]);
    });

    /** An expression is not its column, so an index over one serves no lookup by the key. */
    it('should index a foreign key an expression index only reads', () => {
      @Entity({ indexes: (fkExpression, index) => [index([sql`ABS(${fkExpression.fkBlogId})`])] })
      class FkExpression {
        @Field(f.number().id()) id?: number;
        @Field(f.references(() => FkBlog).nullable()) fkBlogId?: number | null;
      }

      const ast = buildSchemaAST([FkBlog, FkExpression], {
        compileDdl: (sql, entity) => new PostgresDialect().compileDdl(sql, entity),
      });

      expect(indexedColumns(ast, 'FkExpression')).toEqual([['ABS("fkBlogId")'], ['fkBlogId']]);
    });

    /** An index the engine cannot look every row up by: some rows (partial), no equality (fulltext), part of the value (prefix). */
    it('should index a foreign key an index leads with but cannot look it up by', () => {
      @Entity({ indexes: (fkPartial, index) => [index([fkPartial.fkBlogId], { where: { live: true } })] })
      class FkPartial {
        @Field(f.number().id()) id?: number;
        @Field(f.boolean().nullable()) live?: boolean | null;
        @Field(f.references(() => FkBlog).nullable()) fkBlogId?: number | null;
      }

      @Entity({ indexes: (fkFulltext, index) => [index([fkFulltext.fkBlogId], { type: 'fulltext' })] })
      class FkFulltext {
        @Field(f.number().id()) id?: number;
        @Field(f.references(() => FkBlog).nullable()) fkBlogId?: number | null;
      }

      @Entity({ indexes: (fkPrefix, index) => [index([{ column: fkPrefix.fkBlogId, prefixLength: 4 }])] })
      class FkPrefix {
        @Field(f.number().id()) id?: number;
        @Field(f.references(() => FkBlog).nullable()) fkBlogId?: number | null;
      }

      const ast = buildSchemaAST([FkBlog, FkPartial, FkFulltext, FkPrefix], {
        compileDdl: (sql, entity) => new PostgresDialect().compileDdl(sql, entity),
      });

      expect(indexedColumns(ast, 'FkPartial')).toEqual([['fkBlogId'], ['fkBlogId']]);
      expect(indexedColumns(ast, 'FkFulltext')).toEqual([['fkBlogId'], ['fkBlogId']]);
      expect(indexedColumns(ast, 'FkPrefix')).toEqual([['fkBlogId'], ['fkBlogId']]);
    });

    it('should leave a foreign key unindexed when its field opts out', () => {
      @Entity()
      class FkUnindexed {
        @Field(f.number().id()) id?: number;
        @Field(
          f
            .references(() => FkBlog)
            .nullable()
            .index(false),
        )
        fkBlogId?: number | null;
      }

      expect(indexedColumns(buildSchemaAST([FkBlog, FkUnindexed]), 'FkUnindexed')).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should keep an include column that names no field as written', () => {
      @Entity({
        indexes: (covering, index) => [
          // Outside the types, which name a field; a column the entity does not model still reaches the DDL.
          // @ts-expect-error: a column the entity does not model
          index([covering.tenantId], { include: [covering['legacy_total']] }),
        ],
      })
      class Covering {
        @Field(f.number().id()) id?: number;
        @Field(f.number().nullable()) tenantId?: number | null;
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
        @Field(f.number().id()) id?: number;
        @Field(f.string().nullable().index()) name?: string | null;
      }

      let callCount = 0;
      const ast = buildSchemaAST([RenamedColumn], { resolveColumnName: () => `c${++callCount}` });

      expect(ast.getTable('RenamedColumn')?.indexes).toEqual([]);
    });

    it('should skip a relation to an entity outside the set it builds', () => {
      @Entity()
      class OutsideParent {
        @Field(f.number().id()) id?: number;
      }
      @Entity()
      class InsideChild {
        @Field(f.number().id()) id?: number;
        @Field(f.references(() => OutsideParent).nullable()) parentId?: number | null;
      }

      const ast = buildSchemaAST([InsideChild]);

      expect([...ast.tables.keys()]).toEqual(['InsideChild']);
      expect(ast.relationships).toEqual([]);
    });

    it('should make an integer key auto-increment unless it says otherwise', () => {
      @Entity()
      class AutoInc {
        @Field(f.number().id()) id?: number;
      }
      @Entity()
      class NoAutoInc {
        @Field(f.number().id().autoIncrement(false)) id?: number;
      }

      const ast = buildSchemaAST([AutoInc, NoAutoInc]);

      expect(ast.getTable('AutoInc')?.columns.get('id')?.isAutoIncrement).toBe(true);
      expect(ast.getTable('NoAutoInc')?.columns.get('id')?.isAutoIncrement).toBe(false);
    });

    it('should name an index declared as `true` after its table and column', () => {
      @Entity()
      class DefaultIndex {
        @Field(f.number().id()) id?: number;
        @Field(f.string().nullable().index()) name?: string | null;
      }

      expect(buildSchemaAST([DefaultIndex]).getTable('DefaultIndex')?.indexes[0].name).toBe('DefaultIndex__name_idx');
    });

    it('should relate a to-one through the column its references name, to the key of its target', () => {
      @Entity()
      class Target {
        @Field(f.number().id()) id?: number;
      }
      @Entity()
      class Source {
        @Field(f.number().id()) id?: number;
        @Field(f.number().nullable()) targetId?: number | null;
        @ManyToOne({ entity: () => Target, references: (source) => source.targetId }) target?: Target;
      }
      @Entity()
      class Member {
        @Field(f.number().id()) id?: number;
        @Field(f.number().nullable()) groupIdKey?: number | null;
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
        @Field(f.number().id()) id?: number;
        @Field(f.string().nullable().index('my_custom_idx')) name?: string | null;
      }
      const ast = buildSchemaAST([CustomIndex]);
      expect(ast.getTable('CustomIndex')?.indexes[0].name).toBe('my_custom_idx');
    });

    it('should name a partial index by its predicate, so an edited predicate is a new name', () => {
      @Entity({ name: 'Order', indexes: (liveOrder, index) => [index([liveOrder.total], { where: { live: true } })] })
      class LiveOrder {
        @Field(f.number().id()) id?: number;
        @Field(f.number().nullable()) total?: number | null;
        @Field(f.boolean().nullable()) live?: boolean | null;
      }
      @Entity({
        name: 'Order',
        indexes: (archivedOrder, index) => [index([archivedOrder.total], { where: { live: false } })],
      })
      class ArchivedOrder {
        @Field(f.number().id()) id?: number;
        @Field(f.number().nullable()) total?: number | null;
        @Field(f.boolean().nullable()) live?: boolean | null;
      }
      const options: Parameters<typeof buildSchemaAST>[1] = {
        compileDdl: (sql, entity) => new PostgresDialect().compileDdl(sql, entity),
      };

      const live = buildSchemaAST([LiveOrder], options).getTable('Order')?.indexes[0]?.name;
      const archived = buildSchemaAST([ArchivedOrder], options).getTable('Order')?.indexes[0]?.name;

      expect(live).toMatch(/^Order__total_[0-9a-f]{6}_idx$/);
      expect(archived).toMatch(/^Order__total_[0-9a-f]{6}_idx$/);
      expect(live).not.toBe(archived);
    });

    it('should give each table inheriting an index its own derived name', () => {
      @Entity({ abstract: true, indexes: (regional, index) => [index([regional.region])] })
      class Regional {
        @Field(f.number().id()) id?: number;
        @Field(f.string().nullable()) region?: string | null;
      }
      @Entity()
      class Depot extends Regional {}
      @Entity()
      class Outlet extends Regional {}

      const ast = buildSchemaAST([Depot, Outlet]);

      expect(ast.getTable('Depot')?.indexes.map((index) => index.name)).toEqual(['Depot__region_idx']);
      expect(ast.getTable('Outlet')?.indexes.map((index) => index.name)).toEqual(['Outlet__region_idx']);
    });

    it('should drop a foreign key whose columns do not resolve to the tables it joins', () => {
      @Entity()
      class UnresolvedParent {
        @Field(f.number().id()) id?: number;
      }
      @Entity()
      class UnresolvedChild {
        @Field(f.number().id()) id?: number;
        @Field(f.references(() => UnresolvedParent).nullable()) parentId?: number | null;
      }

      let callCount = 0;
      const ast = buildSchemaAST([UnresolvedParent, UnresolvedChild], { resolveColumnName: () => `c${++callCount}` });

      expect(ast.relationships).toEqual([]);
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
