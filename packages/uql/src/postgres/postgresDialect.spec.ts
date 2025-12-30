import { expect } from 'bun:test';
import {
  Company,
  createSpec,
  Item,
  ItemTag,
  Profile,
  TaxCategory,
  User,
  UserWithNonUpdatableId,
} from '../test/index.js';
import { raw } from '../util/index.js';
import { PostgresDialect } from './postgresDialect.js';

class PostgresDialectSpec {
  readonly dialect = new PostgresDialect();

  protected exec(fn: (ctx: any) => void): { sql: string; values: unknown[] } {
    const ctx = this.dialect.createContext();
    fn(ctx);
    return { sql: ctx.sql, values: ctx.values };
  }

  shouldBeValidEscapeCharacter() {
    expect(this.dialect.escapeIdChar).toBe('"');
  }

  shouldBeginTransaction() {
    expect(this.dialect.beginTransactionCommand).toBe('BEGIN TRANSACTION');
  }

  shouldInsertMany() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.insert(ctx, User, [
        {
          name: 'Some name 1',
          email: 'someemail1@example.com',
          createdAt: 123,
        },
        {
          name: 'Some name 2',
          email: 'someemail2@example.com',
          createdAt: 456,
        },
        {
          name: 'Some name 3',
          email: 'someemail3@example.com',
          createdAt: 789,
        },
      ]),
    );
    expect(sql).toBe(
      'INSERT INTO "User" ("name", "email", "createdAt") VALUES' +
        ' ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)' +
        ' RETURNING "id" "id"',
    );
    expect(values).toEqual([
      'Some name 1',
      'someemail1@example.com',
      123,
      'Some name 2',
      'someemail2@example.com',
      456,
      'Some name 3',
      'someemail3@example.com',
      789,
    ]);
  }

  shouldInsertOne() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.insert(ctx, User, {
        name: 'Some Name',
        email: 'someemail@example.com',
        createdAt: 123,
      }),
    );
    expect(sql).toBe('INSERT INTO "User" ("name", "email", "createdAt") VALUES ($1, $2, $3) RETURNING "id" "id"');
    expect(values).toEqual(['Some Name', 'someemail@example.com', 123]);
  }

  shouldInsertWithOnInsertId() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.insert(ctx, TaxCategory, {
        name: 'Some Name',
        createdAt: 123,
      }),
    );
    expect(sql).toMatch(
      /^INSERT INTO "TaxCategory" \("name", "createdAt", "pk"\) VALUES \(\$1, \$2, \$3\) RETURNING "pk" "id"$/,
    );
    expect(values[0]).toBe('Some Name');
    expect(values[1]).toBe(123);
    expect(values[2]).toMatch(/.+/);
  }

  shouldUpsert() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        User,
        { id: true },
        {
          id: 1,
          name: 'Some Name',
          createdAt: 123,
        },
      ),
    );
    expect(sql).toMatch(
      /^INSERT INTO "User" \("id", "name", "createdAt", "updatedAt"\) VALUES \(\$1, \$2, \$3, \$4\) ON CONFLICT \("id"\) DO UPDATE SET "name" = EXCLUDED."name", "createdAt" = EXCLUDED."createdAt", "updatedAt" = EXCLUDED."updatedAt" RETURNING "id" "id"$/,
    );
    expect(values).toEqual([1, 'Some Name', 123, expect.any(Number)]);
  }

  shouldUpsertWithDifferentColumnNames() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        Profile,
        { pk: true },
        {
          pk: 1,
          picture: 'image.jpg',
        },
      ),
    );
    expect(sql).toMatch(
      /^INSERT INTO "user_profile" \("pk", "image", "updatedAt", "createdAt"\) VALUES \(\$1, \$2, \$3, \$4\) ON CONFLICT \("pk"\) DO UPDATE SET "image" = EXCLUDED."image", "updatedAt" = EXCLUDED."updatedAt" RETURNING "pk" "id"$/,
    );
    expect(values).toEqual([1, 'image.jpg', expect.any(Number), expect.any(Number)]);
  }

  shouldUpsertWithNonUpdatableFields() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        User,
        { id: true },
        {
          id: 1,
          email: 'a@b.com',
        },
      ),
    );
    expect(sql).toMatch(
      /^INSERT INTO "User" \("id", "email", "updatedAt", "createdAt"\) VALUES \(\$1, \$2, \$3, \$4\) ON CONFLICT \("id"\) DO UPDATE SET "updatedAt" = EXCLUDED."updatedAt" RETURNING "id" "id"$/,
    );
    expect(values).toEqual([1, 'a@b.com', expect.any(Number), expect.any(Number)]);
  }

  shouldUpsertWithNonUpdatableId() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        UserWithNonUpdatableId,
        { id: true },
        {
          id: 1,
          name: 'Some Name',
        },
      ),
    );
    expect(sql).toBe(
      'INSERT INTO "UserWithNonUpdatableId" ("id", "name") VALUES ($1, $2) ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name" RETURNING "id" "id"',
    );
    expect(values).toEqual([1, 'Some Name']);
  }

  shouldUpsertWithDoNothing() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        ItemTag,
        { id: true },
        {
          id: 1,
        },
      ),
    );
    expect(sql).toBe('INSERT INTO "ItemTag" ("id") VALUES ($1) ON CONFLICT ("id") DO NOTHING RETURNING "id" "id"');
    expect(values).toEqual([1]);
  }

  shouldUpsertWithCompositeKeys() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        ItemTag,
        { itemId: true, tagId: true },
        {
          itemId: 1,
          tagId: 2,
        },
      ),
    );
    expect(sql).toBe(
      'INSERT INTO "ItemTag" ("itemId", "tagId") VALUES ($1, $2) ON CONFLICT ("itemId", "tagId") DO NOTHING RETURNING "id" "id"',
    );
    expect(values).toEqual([1, 2]);
  }

  shouldUpsertWithOnUpdateField() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        User,
        { id: true },
        {
          id: 1,
          name: 'Some Name',
        },
      ),
    );
    expect(sql).toMatch(
      /^INSERT INTO "User" \(.*"id".*"name".*"updatedAt".*"createdAt".*\) VALUES \(.*\$1, \$2, \$3, \$4.*\) ON CONFLICT \("id"\) DO UPDATE SET .*"name" = EXCLUDED."name".*"updatedAt" = EXCLUDED."updatedAt".*$/,
    );
    expect(values).toEqual([1, 'Some Name', expect.any(Number), expect.any(Number)]);
  }

  shouldUpsertWithVirtualField() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        Item,
        { id: true },
        {
          id: 1,
          name: 'Some Item',
          tagsCount: 5,
        },
      ),
    );
    expect(sql).toMatch(
      /^INSERT INTO "Item" \("id", "name", "updatedAt", "createdAt"\) VALUES \(\$1, \$2, \$3, \$4\) ON CONFLICT \("id"\) DO UPDATE SET "name" = EXCLUDED."name", "updatedAt" = EXCLUDED."updatedAt" RETURNING "id" "id"$/,
    );
    expect(values).toEqual([1, 'Some Item', expect.any(Number), expect.any(Number)]);
  }

  shouldFind$istartsWith() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: { $istartsWith: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "User" WHERE "name" ILIKE $1 ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0');
    expect(res.values).toEqual(['Some%']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $istartsWith: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      'SELECT "id" FROM "User" WHERE ("name" ILIKE $1 AND "name" <> $2) ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0',
    );
    expect(res.values).toEqual(['Some%', 'Something']);
  }

  shouldFind$iendsWith() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: { $iendsWith: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "User" WHERE "name" ILIKE $1 ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0');
    expect(res.values).toEqual(['%Some']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $iendsWith: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      'SELECT "id" FROM "User" WHERE ("name" ILIKE $1 AND "name" <> $2) ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0',
    );
    expect(res.values).toEqual(['%Some', 'Something']);
  }

  shouldFind$iincludes() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: { $iincludes: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "User" WHERE "name" ILIKE $1 ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0');
    expect(res.values).toEqual(['%Some%']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $iincludes: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      'SELECT "id" FROM "User" WHERE ("name" ILIKE $1 AND "name" <> $2) ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0',
    );
    expect(res.values).toEqual(['%Some%', 'Something']);
  }

  shouldFind$ilike() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: { $ilike: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "User" WHERE "name" ILIKE $1 ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0');
    expect(res.values).toEqual(['Some']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $ilike: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      'SELECT "id" FROM "User" WHERE ("name" ILIKE $1 AND "name" <> $2) ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0',
    );
    expect(res.values).toEqual(['Some', 'Something']);
  }

  shouldFind$regex() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $regex: '^some' } },
      }),
    );
    expect(sql).toBe('SELECT "id" FROM "User" WHERE "name" ~ $1');
    expect(values).toEqual(['^some']);
  }

  shouldFind$text() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { $text: { $fields: ['name', 'description'], $value: 'some text' }, code: '1' },
        $limit: 30,
      }),
    );
    expect(res.sql).toBe(
      'SELECT "id" FROM "Item" WHERE to_tsvector("name" || \' \' || "description") @@ to_tsquery($1) AND "code" = $2 LIMIT 30',
    );
    expect(res.values).toEqual(['some text', '1']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: {
          $text: { $fields: ['name'], $value: 'something' },
          name: { $ne: 'other unwanted' },
          creatorId: 1,
        },
        $limit: 10,
      }),
    );
    expect(res.sql).toBe(
      'SELECT "id" FROM "User" WHERE to_tsvector("name") @@ to_tsquery($1) AND "name" <> $2 AND "creatorId" = $3 LIMIT 10',
    );
    expect(res.values).toEqual(['something', 'other unwanted', 1]);
  }

  shouldUpdateWithRawString() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        Company,
        { $where: { id: 1 } },
        {
          kind: raw("jsonb_set(kind, '{open}', to_jsonb(1))"),
          updatedAt: 123,
        },
      ),
    );
    expect(sql).toBe(
      'UPDATE "Company" SET "kind" = jsonb_set(kind, \'{open}\', to_jsonb(1)), "updatedAt" = $1 WHERE "id" = $2',
    );
    expect(values).toEqual([123, 1]);
  }

  shouldUpdateWithJsonbField() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        Company,
        { $where: { id: 1 } },
        {
          kind: { private: 1 },
          updatedAt: 123,
        },
      ),
    );
    expect(sql).toBe('UPDATE "Company" SET "kind" = $1::jsonb, "updatedAt" = $2 WHERE "id" = $3');
    expect(values).toEqual(['{"private":1}', 123, 1]);
  }
}

createSpec(new PostgresDialectSpec());
