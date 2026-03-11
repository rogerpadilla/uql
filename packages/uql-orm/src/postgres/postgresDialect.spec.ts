import { expect } from 'vitest';
import { Entity, Field, Id } from '../entity/index.js';
import {
  Company,
  createSpec,
  Item,
  ItemTag,
  MeasureUnitCategory,
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

  shouldGetBeginTransactionStatementsWithoutIsolationLevel() {
    expect(this.dialect.getBeginTransactionStatements()).toEqual(['BEGIN TRANSACTION']);
  }

  shouldGetBeginTransactionStatementsWithIsolationLevel() {
    expect(this.dialect.getBeginTransactionStatements('read committed')).toEqual([
      'BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED',
    ]);
    expect(this.dialect.getBeginTransactionStatements('serializable')).toEqual([
      'BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE',
    ]);
    expect(this.dialect.getBeginTransactionStatements('repeatable read')).toEqual([
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ',
    ]);
    expect(this.dialect.getBeginTransactionStatements('read uncommitted')).toEqual([
      'BEGIN TRANSACTION ISOLATION LEVEL READ UNCOMMITTED',
    ]);
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

  shouldUpsertMany() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(ctx, User, { id: true }, [
        {
          id: 1,
          name: 'Name A',
          createdAt: 100,
        },
        {
          id: 2,
          name: 'Name B',
          createdAt: 200,
        },
      ]),
    );
    expect(sql).toMatch(
      /^INSERT INTO "User" .*VALUES \(\$1, \$2, \$3, \$4\), \(\$5, \$6, \$7, \$8\) ON CONFLICT \("id"\) DO UPDATE SET.*RETURNING/,
    );
    expect(values).toHaveLength(8);
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
        $select: { id: true },
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
        $select: { id: true },
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
        $select: { id: true },
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
        $select: { id: true },
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

  shouldFind$nin() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { id: { $nin: [1, 2] } },
      }),
    );
    expect(sql).toBe('SELECT "id" FROM "User" WHERE "id" <> ALL($1)');
    expect(values).toEqual([[1, 2]]);
  }

  shouldFormatVector() {
    @Entity({ name: 'VectorItem' })
    class VectorItem {
      @Id() id?: number;
      @Field({ type: 'vector' }) vec!: number[];
    }
    const { sql, values } = this.exec((ctx) =>
      this.dialect.insert(ctx, VectorItem, {
        vec: [1, 2, 3],
      }),
    );
    expect(sql).toBe('INSERT INTO "VectorItem" ("vec") VALUES ($1::vector) RETURNING "id" "id"');
    expect(values).toEqual(['[1,2,3]']);
  }

  shouldEscape() {
    expect(this.dialect.escape("it's")).toBe("'it''s'");
  }

  // JSONB operator tests
  shouldFind$elemMatch() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { kind: { $elemMatch: { city: 'NYC', zip: '10001' } } } as any,
      }),
    );
    expect(sql).toBe('SELECT "id" FROM "Company" WHERE "kind" @> $1::jsonb');
    expect(values).toEqual(['[{"city":"NYC","zip":"10001"}]']);
  }

  shouldFind$all() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { kind: { $all: ['admin', 'user'] } } as any,
      }),
    );
    expect(sql).toBe('SELECT "id" FROM "Company" WHERE "kind" @> $1::jsonb');
    expect(values).toEqual(['["admin","user"]']);
  }

  shouldFind$size() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { kind: { $size: 3 } } as any,
      }),
    );
    expect(sql).toBe('SELECT "id" FROM "Company" WHERE jsonb_array_length("kind") = $1');
    expect(values).toEqual([3]);
  }

  shouldFind$sizeWithComparison() {
    // Single comparison operator
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { kind: { $size: { $gte: 2 } } } as any,
      }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "Company" WHERE jsonb_array_length("kind") >= $1');
    expect(res.values).toEqual([2]);

    // Multiple comparison operators
    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { kind: { $size: { $gt: 0, $lte: 5 } } } as any,
      }),
    );
    expect(res.sql).toBe(
      'SELECT "id" FROM "Company" WHERE (jsonb_array_length("kind") > $1 AND jsonb_array_length("kind") <= $2)',
    );
    expect(res.values).toEqual([0, 5]);

    // $between
    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { kind: { $size: { $between: [1, 10] } } } as any,
      }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "Company" WHERE jsonb_array_length("kind") BETWEEN $1 AND $2');
    expect(res.values).toEqual([1, 10]);
  }

  // Tests for $elemMatch with nested operators
  shouldFind$elemMatchWithOperators() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { kind: { $elemMatch: { city: { $ilike: 'new%' } } } } as any,
      }),
    );
    expect(sql).toBe(
      'SELECT "id" FROM "Company" WHERE EXISTS (SELECT 1 FROM jsonb_array_elements("kind") AS elem WHERE elem->>\'city\' ILIKE $1)',
    );
    expect(values).toEqual(['new%']);
  }

  shouldFind$elemMatchWithMultipleOperators() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { kind: { $elemMatch: { price: { $gt: 100 }, active: { $eq: true } } } } as any,
      }),
    );
    expect(sql).toBe(
      'SELECT "id" FROM "Company" WHERE EXISTS (SELECT 1 FROM jsonb_array_elements("kind") AS elem WHERE (elem->>\'price\')::numeric > $1 AND elem->>\'active\' = $2)',
    );
    expect(values).toEqual([100, true]);
  }

  shouldFind$elemMatchWithMixedConditions() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { kind: { $elemMatch: { name: 'exact', status: { $in: ['active', 'pending'] } } } } as any,
      }),
    );
    expect(sql).toBe(
      'SELECT "id" FROM "Company" WHERE EXISTS (SELECT 1 FROM jsonb_array_elements("kind") AS elem WHERE elem->>\'name\' = $1 AND elem->>\'status\' = ANY($2))',
    );
    expect(values).toEqual(['exact', ['active', 'pending']]);
  }

  shouldFind$elemMatchWithStringOperators() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { kind: { $elemMatch: { name: { $startsWith: 'Test' } } } } as any,
      }),
    );
    expect(sql).toBe(
      'SELECT "id" FROM "Company" WHERE EXISTS (SELECT 1 FROM jsonb_array_elements("kind") AS elem WHERE elem->>\'name\' LIKE $1)',
    );
    expect(values).toEqual(['Test%']);
  }

  shouldFind$elemMatchWithAllOperators() {
    // Test $ne
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { kind: { $elemMatch: { status: { $ne: 'deleted' } } } } as any,
      }),
    );
    expect(res.sql).toContain("elem->>'status' IS DISTINCT FROM $1");

    // Test $gte, $lt, $lte
    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { kind: { $elemMatch: { qty: { $gte: 10 }, price: { $lt: 50 }, discount: { $lte: 20 } } } } as any,
      }),
    );
    expect(res.sql).toContain("(elem->>'qty')::numeric >= $1");
    expect(res.sql).toContain("(elem->>'price')::numeric < $2");
    expect(res.sql).toContain("(elem->>'discount')::numeric <= $3");

    // Test $like, $endsWith, $iendsWith, $istartsWith, $includes, $iincludes
    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: {
          kind: {
            $elemMatch: {
              a: { $like: '%x%' },
              b: { $endsWith: '.pdf' },
              c: { $iendsWith: '.PDF' },
              d: { $istartsWith: 'Hi' },
              e: { $includes: 'mid' },
              f: { $iincludes: 'MID' },
            },
          },
        } as any,
      }),
    );
    expect(res.sql).toContain("elem->>'a' LIKE");
    expect(res.sql).toContain("elem->>'b' LIKE");
    expect(res.sql).toContain("elem->>'c' ILIKE");
    expect(res.sql).toContain("elem->>'d' ILIKE");
    expect(res.sql).toContain("elem->>'e' LIKE");
    expect(res.sql).toContain("elem->>'f' ILIKE");

    // Test $regex, $nin
    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { kind: { $elemMatch: { code: { $regex: '^A' }, tag: { $nin: ['x', 'y'] } } } } as any,
      }),
    );
    expect(res.sql).toContain("elem->>'code' ~ $1");
    expect(res.sql).toContain("elem->>'tag' <> ALL");
  }

  // JSONB dot-notation tests (Postgres-specific)
  shouldFindByJsonDotNotation() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { 'kind.public': 1 } as any,
      }),
    );
    expect(sql).toBe('SELECT "id" FROM "Company" WHERE ("kind"->>\'public\') = $1');
    expect(values).toEqual([1]);
  }

  shouldFindByJsonDotNotationWithOperator() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { 'kind.private': { $ne: 0 } } as any,
      }),
    );
    expect(sql).toBe('SELECT "id" FROM "Company" WHERE ("kind"->>\'private\') IS DISTINCT FROM $1');
    expect(values).toEqual([0]);
  }

  shouldFindByJsonDotNotationWithNumericCast() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { 'kind.public': { $gt: 0, $lte: 5 } } as any,
      }),
    );
    expect(sql).toBe(
      'SELECT "id" FROM "Company" WHERE ((("kind"->>\'public\'))::numeric > $1 AND (("kind"->>\'public\'))::numeric <= $2)',
    );
    expect(values).toEqual([0, 5]);
  }

  shouldFindByJsonDotNotationWithIlike() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { 'kind.public': { $ilike: '%active%' } } as any,
      }),
    );
    expect(sql).toBe('SELECT "id" FROM "Company" WHERE ("kind"->>\'public\') ILIKE $1');
    expect(values).toEqual(['%active%']);
  }

  // ManyToMany relation filtering (Postgres-specific)
  shouldFindByManyToManyRelation() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { tags: { id: 5 } } as any,
      }),
    );
    expect(sql).toBe(
      'SELECT "id" FROM "Item" WHERE EXISTS (SELECT 1 FROM "ItemTag" WHERE "ItemTag"."itemId" = "Item"."id" AND "ItemTag"."tagId" IN (SELECT "Tag"."id" FROM "Tag" WHERE "Tag"."id" = $1))',
    );
    expect(values).toEqual([5]);
  }

  shouldFindByOneToManyRelation() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, MeasureUnitCategory, {
        $select: { id: true },
        $where: { measureUnits: { name: 'kg' } } as any,
      }),
    );
    expect(sql).toBe(
      'SELECT "id" FROM "MeasureUnitCategory" WHERE EXISTS (SELECT 1 FROM "MeasureUnit" WHERE "MeasureUnit"."categoryId" = "MeasureUnitCategory"."id" AND "MeasureUnit"."name" = $1) AND "deletedAt" IS NULL',
    );
    expect(values).toEqual(['kg']);
  }

  shouldFindByJsonDotNotationDeepPath() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { 'kind.theme.color': 'red' } as any,
      }),
    );
    expect(sql).toBe('SELECT "id" FROM "Company" WHERE (("kind"->\'theme\')->>\'color\') = $1');
    expect(values).toEqual(['red']);
  }

  shouldUpdateWithJsonMerge() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        Company,
        { $where: { id: 1 } },
        {
          kind: { $merge: { private: 1 } },
          updatedAt: 123,
        },
      ),
    );
    expect(sql).toBe(
      'UPDATE "Company" SET "kind" = COALESCE("kind", \'{}\') || $1::jsonb, "updatedAt" = $2 WHERE "id" = $3',
    );
    expect(values).toEqual(['{"private":1}', 123, 1]);
  }

  shouldUpdateWithJsonMergeUnsetOnly() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        Company,
        { $where: { id: 1 } },
        {
          kind: { $unset: ['public', 'private'] },
          updatedAt: 123,
        },
      ),
    );
    expect(sql).toBe(
      'UPDATE "Company" SET "kind" = (("kind") - \'public\') - \'private\', "updatedAt" = $1 WHERE "id" = $2',
    );
    expect(values).toEqual([123, 1]);
  }

  shouldUpdateWithJsonMergeCombined() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        Company,
        { $where: { id: 1 } },
        {
          kind: { $merge: { private: 1 }, $unset: ['public'] },
          updatedAt: 123,
        },
      ),
    );
    expect(sql).toBe(
      'UPDATE "Company" SET "kind" = (COALESCE("kind", \'{}\') || $1::jsonb) - \'public\', "updatedAt" = $2 WHERE "id" = $3',
    );
    expect(values).toEqual(['{"private":1}', 123, 1]);
  }

  shouldSortByJsonDotNotation() {
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $sort: { 'kind.public': 1 },
      }),
    );
    expect(sql).toBe('SELECT "id" FROM "Company" ORDER BY ("kind"->>\'public\')');
  }

  shouldSortByJsonDotNotationDeep() {
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $sort: { 'kind.theme.color': -1 } as any,
      }),
    );
    expect(sql).toBe('SELECT "id" FROM "Company" ORDER BY (("kind"->\'theme\')->>\'color\') DESC');
  }
}

createSpec(new PostgresDialectSpec());
