import { Company, createSpec, Item, ItemTag, Profile, TaxCategory, User, UserWithNonUpdatableId } from 'nukak/test';
import { raw } from 'nukak/util';
import { PostgresDialect } from './postgresDialect.js';

class PostgresDialectSpec {
  readonly dialect = new PostgresDialect();

  shouldBeValidEscapeCharacter() {
    expect(this.dialect.escapeIdChar).toBe('"');
  }

  shouldBeginTransaction() {
    expect(this.dialect.beginTransactionCommand).toBe('BEGIN TRANSACTION');
  }

  shouldInsertMany() {
    expect(
      this.dialect.insert(User, [
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
    ).toBe(
      'INSERT INTO "User" ("name", "email", "createdAt") VALUES' +
        " ('Some name 1', 'someemail1@example.com', 123)" +
        ", ('Some name 2', 'someemail2@example.com', 456)" +
        ", ('Some name 3', 'someemail3@example.com', 789)" +
        ' RETURNING "id" "id"',
    );
  }

  shouldInsertOne() {
    expect(
      this.dialect.insert(User, {
        name: 'Some Name',
        email: 'someemail@example.com',
        createdAt: 123,
      }),
    ).toBe(
      `INSERT INTO "User" ("name", "email", "createdAt") VALUES ('Some Name', 'someemail@example.com', 123) RETURNING "id" "id"`,
    );
  }

  shouldInsertWithOnInsertId() {
    expect(
      this.dialect.insert(TaxCategory, {
        name: 'Some Name',
        createdAt: 123,
      }),
    ).toMatch(
      /^INSERT INTO "TaxCategory" \("name", "createdAt", "pk"\) VALUES \('Some Name', 123, '.+'\) RETURNING "pk" "id"$/,
    );
  }

  shouldUpsert() {
    expect(
      this.dialect.upsert(
        User,
        { id: true },
        {
          id: 1,
          name: 'Some Name',
          createdAt: 123,
        },
      ),
    ).toMatch(
      /^INSERT INTO "User" \("id", "name", "createdAt"\) VALUES \(1, 'Some Name', 123\) ON CONFLICT \("id"\) DO UPDATE SET "name" = EXCLUDED."name", "createdAt" = EXCLUDED."createdAt", "updatedAt" = EXCLUDED."updatedAt" RETURNING "id" "id"$/,
    );
  }

  shouldUpsertWithDifferentColumnNames() {
    expect(
      this.dialect.upsert(
        Profile,
        { pk: true },
        {
          pk: 1,
          picture: 'image.jpg',
        },
      ),
    ).toMatch(
      /^INSERT INTO "user_profile" \("pk", "image", "createdAt"\) VALUES \(1, 'image.jpg', .+\) ON CONFLICT \("pk"\) DO UPDATE SET "image" = EXCLUDED."image", "createdAt" = EXCLUDED."createdAt", "updatedAt" = EXCLUDED."updatedAt" RETURNING "pk" "id"$/,
    );
  }

  shouldUpsertWithNonUpdatableFields() {
    expect(
      this.dialect.upsert(
        User,
        { id: true },
        {
          id: 1,
          email: 'a@b.com',
        },
      ),
    ).toMatch(
      /^INSERT INTO "User" \("id", "email", "createdAt"\) VALUES \(1, 'a@b.com', .+\) ON CONFLICT \("id"\) DO UPDATE SET "createdAt" = EXCLUDED."createdAt", "updatedAt" = EXCLUDED."updatedAt" RETURNING "id" "id"$/,
    );
  }

  shouldUpsertWithNonUpdatableId() {
    expect(
      this.dialect.upsert(
        UserWithNonUpdatableId,
        { id: true },
        {
          id: 1,
          name: 'Some Name',
        },
      ),
    ).toBe(
      'INSERT INTO "UserWithNonUpdatableId" ("id", "name") VALUES (1, \'Some Name\') ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name" RETURNING "id" "id"',
    );
  }

  shouldUpsertWithDoNothing() {
    expect(
      this.dialect.upsert(
        ItemTag,
        { id: true },
        {
          id: 1,
        },
      ),
    ).toBe('INSERT INTO "ItemTag" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING RETURNING "id" "id"');
  }

  shouldUpsertWithCompositeKeys() {
    expect(
      this.dialect.upsert(
        ItemTag,
        { itemId: true, tagId: true },
        {
          itemId: 1,
          tagId: 2,
        },
      ),
    ).toBe(
      'INSERT INTO "ItemTag" ("itemId", "tagId") VALUES (1, 2) ON CONFLICT ("itemId", "tagId") DO NOTHING RETURNING "id" "id"',
    );
  }

  shouldUpsertWithOnUpdateField() {
    expect(
      this.dialect.upsert(
        User,
        { id: true },
        {
          id: 1,
          name: 'Some Name',
        },
      ),
    ).toMatch(
      /^INSERT INTO "User" \(.*"id".*"name".*"createdAt".*\) VALUES \(.*1.*'Some Name'.*\) ON CONFLICT \("id"\) DO UPDATE SET .*"name" = EXCLUDED."name".*"updatedAt" = EXCLUDED."updatedAt".*$/,
    );
  }

  shouldUpsertWithVirtualField() {
    expect(
      this.dialect.upsert(
        Item,
        { id: true },
        {
          id: 1,
          name: 'Some Item',
          tagsCount: 5,
        },
      ),
    ).toMatch(
      /^INSERT INTO "Item" \("id", "name", "createdAt"\) VALUES \(1, 'Some Item', .+\) ON CONFLICT \("id"\) DO UPDATE SET "name" = EXCLUDED."name", "createdAt" = EXCLUDED."createdAt", "updatedAt" = EXCLUDED."updatedAt" RETURNING "id" "id"$/,
    );
  }

  shouldFind$istartsWith() {
    expect(
      this.dialect.find(User, {
        $select: ['id'],
        $where: { name: { $istartsWith: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    ).toBe(`SELECT "id" FROM "User" WHERE "name" ILIKE 'Some%' ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0`);

    expect(
      this.dialect.find(User, {
        $select: { id: true },
        $where: { name: { $istartsWith: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    ).toBe(
      `SELECT "id" FROM "User" WHERE ("name" ILIKE 'Some%' AND "name" <> 'Something') ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0`,
    );
  }

  shouldFind$iendsWith() {
    expect(
      this.dialect.find(User, {
        $select: ['id'],
        $where: { name: { $iendsWith: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    ).toBe(`SELECT "id" FROM "User" WHERE "name" ILIKE '%Some' ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0`);

    expect(
      this.dialect.find(User, {
        $select: { id: true },
        $where: { name: { $iendsWith: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    ).toBe(
      `SELECT "id" FROM "User" WHERE ("name" ILIKE '%Some' AND "name" <> 'Something') ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0`,
    );
  }

  shouldFind$iincludes() {
    expect(
      this.dialect.find(User, {
        $select: ['id'],
        $where: { name: { $iincludes: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    ).toBe(`SELECT "id" FROM "User" WHERE "name" ILIKE '%Some%' ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0`);

    expect(
      this.dialect.find(User, {
        $select: { id: true },
        $where: { name: { $iincludes: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    ).toBe(
      `SELECT "id" FROM "User" WHERE ("name" ILIKE '%Some%' AND "name" <> 'Something') ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0`,
    );
  }

  shouldFind$ilike() {
    expect(
      this.dialect.find(User, {
        $select: ['id'],
        $where: { name: { $ilike: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    ).toBe(`SELECT "id" FROM "User" WHERE "name" ILIKE 'Some' ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0`);

    expect(
      this.dialect.find(User, {
        $select: { id: true },
        $where: { name: { $ilike: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    ).toBe(
      `SELECT "id" FROM "User" WHERE ("name" ILIKE 'Some' AND "name" <> 'Something') ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0`,
    );
  }

  shouldFind$regex() {
    expect(
      this.dialect.find(User, {
        $select: { id: true },
        $where: { name: { $regex: '^some' } },
      }),
    ).toBe(`SELECT "id" FROM "User" WHERE "name" ~ '^some'`);
  }

  shouldFind$text() {
    expect(
      this.dialect.find(Item, {
        $select: { id: true },
        $where: { $text: { $fields: ['name', 'description'], $value: 'some text' }, code: '1' },
        $limit: 30,
      }),
    ).toBe(
      `SELECT "id" FROM "Item" WHERE to_tsvector("name" || ' ' || "description") @@ to_tsquery('some text') AND "code" = '1' LIMIT 30`,
    );

    expect(
      this.dialect.find(User, {
        $select: { id: true },
        $where: {
          $text: { $fields: ['name'], $value: 'something' },
          name: { $ne: 'other unwanted' },
          creatorId: 1,
        },
        $limit: 10,
      }),
    ).toBe(
      `SELECT "id" FROM "User" WHERE to_tsvector("name") @@ to_tsquery('something') AND "name" <> 'other unwanted' AND "creatorId" = 1 LIMIT 10`,
    );
  }

  shouldUpdateWithRawString() {
    expect(
      this.dialect.update(
        Company,
        { $where: { id: 1 } },
        {
          kind: raw("jsonb_set(kind, '{open}', to_jsonb(1))"),
          updatedAt: 123,
        },
      ),
    ).toBe('UPDATE "Company" SET "kind" = jsonb_set(kind, \'{open}\', to_jsonb(1)), "updatedAt" = 123 WHERE "id" = 1');
  }

  shouldUpdateWithJsonbField() {
    expect(
      this.dialect.update(
        Company,
        { $where: { id: 1 } },
        {
          kind: { private: 1 },
          updatedAt: 123,
        },
      ),
    ).toBe('UPDATE "Company" SET "kind" = \'{"private":1}\'::jsonb, "updatedAt" = 123 WHERE "id" = 1');
  }
}

createSpec(new PostgresDialectSpec());
