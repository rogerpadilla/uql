import { describe, expect, it } from 'vitest';
import { withContext } from '../context/context.js';
import { defineEntity, defineView, f } from '../entity/index.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { SnakeCaseNamingStrategy } from '../namingStrategy/index.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import '../test/secureEntityMock.js';
import { renderSql } from '../type/querySql.js';
import { $context } from '../util/contextRefs.js';
import { refs, sql, tableOf } from '../util/sql.js';

const Item = defineEntity({
  name: 'ViewItem',
  fields: {
    id: f.number().autoIncrement(),
    groupId: f.number(),
    tenantId: f.number(),
    published: f.boolean(),
    deletedAt: f.date().nullable().softDelete(),
  },
}).policies([{ must: { tenantId: $context.secureTenantId } }, { allow: {} }]);

const Totals = defineView({
  name: 'ViewTotals',
  from: () => Item,
  aggregate: { $group: { groupId: true }, $select: { total: { $count: '*' } }, $where: { published: true } },
});

const Published = defineView({
  name: 'ViewPublished',
  from: () => Item,
  find: { $select: { id: true, groupId: true }, $where: { published: true } },
});

const Pin = defineEntity({
  name: 'ViewPin',
  fields: { id: f.number().autoIncrement(), publishedId: f.number() },
}).relations((rel) => ({
  published: () => rel.manyToOne(Published, { references: (pin) => pin.publishedId }),
}));

const Tag = defineEntity({ name: 'ViewTag', fields: { id: f.number().autoIncrement() } });

const Link = defineEntity({
  name: 'ViewLink',
  fields: { id: f.number().autoIncrement(), postId: f.number(), tagId: f.number(), active: f.boolean() },
});

const LiveLink = defineView({
  name: 'ViewLiveLink',
  from: () => Link,
  find: { $select: { postId: true, tagId: true }, $where: { active: true } },
}).relations((rel) => ({
  post: () => rel.manyToOne(Post, { references: (link) => link.postId }),
  tag: () => rel.manyToOne(Tag, { references: (link) => link.tagId }),
}));

const Post = defineEntity({ name: 'ViewPost', fields: { id: f.number().autoIncrement() } }).relations((rel) => ({
  tags: () => rel.manyToMany(Tag, { through: () => LiveLink }),
}));

function render(build: (dialect: PostgresDialect, ctx: ReturnType<PostgresDialect['createContext']>) => void) {
  const dialect = new PostgresDialect({});
  const ctx = dialect.createContext();
  withContext({ secureTenantId: 7 }, () => build(dialect, ctx));
  return { sql: ctx.sql, values: ctx.values };
}

describe('reading a view', () => {
  it("should read an aggregate view as its query, held by its source's filters and policies", () => {
    expect(render((dialect, ctx) => dialect.find(ctx, Totals, { $where: { total: { $gt: 5 } } }))).toEqual({
      sql:
        'SELECT "groupId", "total" FROM (SELECT "groupId", COUNT(*) "total" FROM "ViewItem"' +
        ' WHERE "published" = $1 AND "deletedAt" IS NULL AND "tenantId" = $2 GROUP BY "groupId") "ViewTotals"' +
        ' WHERE "total" > $3',
      values: [true, 7, 5],
    });
  });

  it('should read a find view as its query', () => {
    expect(render((dialect, ctx) => dialect.find(ctx, Published, {}))).toEqual({
      sql:
        'SELECT "id", "groupId" FROM (SELECT "id", "groupId" FROM "ViewItem"' +
        ' WHERE "published" = $1 AND "deletedAt" IS NULL AND "tenantId" = $2) "ViewPublished"',
      values: [true, 7],
    });
  });

  it('should join a view a relation reaches as its query', () => {
    expect(render((dialect, ctx) => dialect.find(ctx, Pin, { $populate: { published: true } })).sql).toBe(
      'SELECT "ViewPin"."id", "ViewPin"."publishedId", "published"."id" "published.id",' +
        ' "published"."groupId" "published.groupId" FROM "ViewPin" LEFT JOIN (SELECT "id", "groupId" FROM "ViewItem"' +
        ' WHERE "published" = $1 AND "deletedAt" IS NULL AND "tenantId" = $2) "published"' +
        ' ON "published"."id" = "ViewPin"."publishedId"',
    );
  });

  it('should aggregate over a view as its query', () => {
    expect(
      render((dialect, ctx) => dialect.aggregate(ctx, Totals, { $select: { most: { $max: { total: true } } } })),
    ).toEqual({
      sql:
        'SELECT MAX("total") "most" FROM (SELECT "groupId", COUNT(*) "total" FROM "ViewItem"' +
        ' WHERE "published" = $1 AND "deletedAt" IS NULL AND "tenantId" = $2 GROUP BY "groupId") "ViewTotals"',
      values: [true, 7],
    });
  });

  it("should name its columns as the naming strategy names them, over the query's own", () => {
    const dialect = new PostgresDialect({ namingStrategy: new SnakeCaseNamingStrategy() });
    const ctx = dialect.createContext();
    withContext({ secureTenantId: 7 }, () => dialect.find(ctx, Totals, {}));

    expect(ctx.sql).toBe(
      'SELECT "group_id" "groupId", "total" FROM (SELECT "groupId" "group_id", "total" FROM' +
        ' (SELECT "group_id" "groupId", COUNT(*) "total" FROM "view_item" WHERE "published" = $1' +
        ' AND "deleted_at" IS NULL AND "tenant_id" = $2 GROUP BY "group_id") "_uql_view") "view_totals"',
    );
  });

  it('should render a view in raw SQL as the read does', () => {
    const totals = refs(Totals);

    expect(
      render((dialect, ctx) =>
        renderSql(sql`SELECT ${totals.total} FROM ${tableOf(totals)}`, { ctx, dialect, prefix: '', escapedPrefix: '' }),
      ).sql,
    ).toBe(
      'SELECT "total" FROM (SELECT "groupId", COUNT(*) "total" FROM "ViewItem"' +
        ' WHERE "published" = $1 AND "deletedAt" IS NULL AND "tenantId" = $2 GROUP BY "groupId") "ViewTotals"',
    );
  });

  it('should refuse a lock on a plain view, which has no rows of its own to lock', () => {
    expect(() => render((dialect, ctx) => dialect.find(ctx, Published, { $lock: true }))).toThrow(
      "'ViewPublished' is a plain view: it has no rows of its own to lock",
    );
  });

  it("should refuse a $text search of a plain view where the engine's search reads an index", () => {
    const dialect = new MySqlDialect();
    expect(() =>
      withContext({ secureTenantId: 7 }, () =>
        dialect.find(dialect.createContext(), Published, { $where: { $text: { $value: 'x' } } }),
      ),
    ).toThrow("'ViewPublished' is a plain view: it has no rows of its own to index for a $text search on MySQL");
  });

  it('should read a many-to-many through a plain view as its query', () => {
    expect(render((dialect, ctx) => dialect.find(ctx, Post, { $populate: { tags: true } })).sql).toBe(
      'SELECT "ViewPost"."id", (SELECT COALESCE(JSON_AGG("_uql_row"), \'[]\'::json) FROM (SELECT "tags"."id"::text "id"' +
        ' FROM "ViewTag" "tags" WHERE "tags"."id" IN (SELECT "ViewLiveLink"."tagId" FROM (SELECT "postId", "tagId"' +
        ' FROM "ViewLink" WHERE "active" = $1) "ViewLiveLink" WHERE "ViewLiveLink"."postId" = "ViewPost"."id")) "tags"' +
        ' CROSS JOIN LATERAL (SELECT "tags"."id") "_uql_row") "tags" FROM "ViewPost"',
    );
  });
});
