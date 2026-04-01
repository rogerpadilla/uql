import { expect } from 'vitest';
import { BunSqlPostgresDialect } from '../bunSql/bunSqlPostgresDialect.js';
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
import type { QueryContext, UpdatePayload } from '../type/index.js';
import { raw } from '../util/index.js';
import { PgDialect } from './pgDialect.js';
import { PostgresDialect } from './postgresDialect.js';
import { POSTGRES_WIRE_DRIVER_CAPABILITIES } from './postgresWireDriverCapabilities.js';

class PostgresDialectSpec {
  readonly dialect = new PostgresDialect({});
  readonly pgDialect = new PgDialect();
  readonly wireArrayPostgresDialect = new PostgresDialect({
    driverCapabilities: { ...POSTGRES_WIRE_DRIVER_CAPABILITIES },
  });
  readonly bunSqlPostgresDialect = new BunSqlPostgresDialect();

  protected exec(fn: (ctx: QueryContext) => void, dialect = this.dialect): { sql: string; values: unknown[] } {
    const ctx = dialect.createContext();
    fn(ctx);
    return { sql: ctx.sql, values: ctx.values };
  }

  shouldBeValidEscapeCharacter() {
    expect(this.dialect.escapeIdChar).toBe('"');
  }

  shouldBeginTransaction() {
    expect(this.dialect.beginTransactionCommand).toBe('BEGIN');
  }

  shouldGetBeginTransactionStatementsWithoutIsolationLevel() {
    expect(this.dialect.getBeginTransactionStatements()).toEqual(['BEGIN']);
  }

  shouldGetBeginTransactionStatementsWithIsolationLevel() {
    expect(this.dialect.getBeginTransactionStatements('read committed')).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED',
    ]);
    expect(this.dialect.getBeginTransactionStatements('serializable')).toEqual(['BEGIN ISOLATION LEVEL SERIALIZABLE']);
    expect(this.dialect.getBeginTransactionStatements('repeatable read')).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ',
    ]);
    expect(this.dialect.getBeginTransactionStatements('read uncommitted')).toEqual([
      'BEGIN ISOLATION LEVEL READ UNCOMMITTED',
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
      /^INSERT INTO "User" \("id", "name", "createdAt"\) VALUES \(\$2, \$3, \$4\) ON CONFLICT \("id"\) DO UPDATE SET "name" = EXCLUDED."name", "createdAt" = EXCLUDED."createdAt", "updatedAt" = \$1 RETURNING "id" "id", \(xmax = 0\) AS "_created"$/,
    );
    expect(values).toEqual([expect.any(Number), 1, 'Some Name', 123]);
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
      /^INSERT INTO "User" .*VALUES \(\$2, \$3, \$4\), \(\$5, \$6, \$7\) ON CONFLICT \("id"\) DO UPDATE SET.*RETURNING/,
    );
    expect(values).toHaveLength(7);
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
      /^INSERT INTO "user_profile" \("pk", "image", "createdAt"\) VALUES \(\$2, \$3, \$4\) ON CONFLICT \("pk"\) DO UPDATE SET "image" = EXCLUDED."image", "updatedAt" = \$1 RETURNING "pk" "id", \(xmax = 0\) AS "_created"$/,
    );
    expect(values).toEqual([expect.any(Number), 1, 'image.jpg', expect.any(Number)]);
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
      /^INSERT INTO "User" \("id", "email", "createdAt"\) VALUES \(\$2, \$3, \$4\) ON CONFLICT \("id"\) DO UPDATE SET "updatedAt" = \$1 RETURNING "id" "id", \(xmax = 0\) AS "_created"$/,
    );
    expect(values).toEqual([expect.any(Number), 1, 'a@b.com', expect.any(Number)]);
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
      'INSERT INTO "UserWithNonUpdatableId" ("id", "name") VALUES ($1, $2) ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name" RETURNING "id" "id", (xmax = 0) AS "_created"',
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
    expect(sql).toBe(
      'INSERT INTO "ItemTag" ("id") VALUES ($1) ON CONFLICT ("id") DO NOTHING RETURNING "id" "id", (xmax = 0) AS "_created"',
    );
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
      'INSERT INTO "ItemTag" ("itemId", "tagId") VALUES ($1, $2) ON CONFLICT ("itemId", "tagId") DO NOTHING RETURNING "id" "id", (xmax = 0) AS "_created"',
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
      /^INSERT INTO "User" \(.*"id".*"name".*"createdAt".*\) VALUES \(.*\$2, \$3, \$4.*\) ON CONFLICT \("id"\) DO UPDATE SET .*"name" = EXCLUDED."name".*"updatedAt" = \$1.*$/,
    );
    expect(values).toEqual([expect.any(Number), 1, 'Some Name', expect.any(Number)]);
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
      /^INSERT INTO "Item" \("id", "name", "createdAt"\) VALUES \(\$2, \$3, \$4\) ON CONFLICT \("id"\) DO UPDATE SET "name" = EXCLUDED."name", "updatedAt" = \$1 RETURNING "id" "id", \(xmax = 0\) AS "_created"$/,
    );
    expect(values).toEqual([expect.any(Number), 1, 'Some Item', expect.any(Number)]);
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
    expect(res.values).toEqual(['some%']);

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
      'SELECT "id" FROM "User" WHERE ("name" ILIKE $1 AND "name" IS DISTINCT FROM $2) ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0',
    );
    expect(res.values).toEqual(['some%', 'Something']);
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
    expect(res.values).toEqual(['%some']);

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
      'SELECT "id" FROM "User" WHERE ("name" ILIKE $1 AND "name" IS DISTINCT FROM $2) ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0',
    );
    expect(res.values).toEqual(['%some', 'Something']);
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
    expect(res.values).toEqual(['%some%']);

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
      'SELECT "id" FROM "User" WHERE ("name" ILIKE $1 AND "name" IS DISTINCT FROM $2) ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0',
    );
    expect(res.values).toEqual(['%some%', 'Something']);
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
    expect(res.values).toEqual(['some']);

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
      'SELECT "id" FROM "User" WHERE ("name" ILIKE $1 AND "name" IS DISTINCT FROM $2) ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0',
    );
    expect(res.values).toEqual(['some', 'Something']);
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
      'SELECT "id" FROM "User" WHERE to_tsvector("name") @@ to_tsquery($1) AND "name" IS DISTINCT FROM $2 AND "creatorId" = $3 LIMIT 10',
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
    const payload = { private: 1 };
    // Standard
    let res = this.exec((ctx) =>
      this.dialect.update(ctx, Company, { $where: { id: 1 } }, {
        kind: payload as any,
        updatedAt: 123,
      } as UpdatePayload<Company>),
    );
    expect(res.sql).toBe('UPDATE "Company" SET "kind" = $1::jsonb, "updatedAt" = $2 WHERE "id" = $3');
    expect(res.values).toEqual(['{"private":1}', 123, 1]);

    // Pg Driver
    res = this.exec(
      (ctx) =>
        this.pgDialect.update(ctx, Company, { $where: { id: 1 } }, {
          kind: payload as any,
          updatedAt: 123,
        } as UpdatePayload<Company>),
      this.pgDialect,
    );
    expect(res.sql).toBe('UPDATE "Company" SET "kind" = $1::jsonb, "updatedAt" = $2 WHERE "id" = $3');
    expect(res.values).toEqual(['{"private":1}', 123, 1]);
  }

  shouldFind$nin() {
    const values = [1, 2];
    // Standard (native arrays)
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, { $select: { id: true }, $where: { id: { $nin: values } } }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "User" WHERE "id" <> ALL($1)');
    expect(res.values).toEqual([values]);

    // node-pg (`PgDialect`): same native array binding as base Postgres dialect
    res = this.exec(
      (ctx) => this.pgDialect.find(ctx, User, { $select: { id: true }, $where: { id: { $nin: values } } }),
      this.pgDialect,
    );
    expect(res.sql).toBe('SELECT "id" FROM "User" WHERE "id" <> ALL($1)');
    expect(res.values).toEqual([values]);

    // Bun SQL / wire clients: array literal strings (`toPgArray`)
    res = this.exec(
      (ctx) =>
        this.wireArrayPostgresDialect.find(ctx, User, { $select: { id: true }, $where: { id: { $nin: values } } }),
      this.wireArrayPostgresDialect,
    );
    expect(res.sql).toBe('SELECT "id" FROM "User" WHERE "id" <> ALL($1)');
    expect(res.values).toEqual(['{"1","2"}']);
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

  shouldSortByVectorSimilarityDefaultCosine() {
    @Entity({ name: 'VectorItem' })
    class VectorItem {
      @Id() id?: number;
      @Field({ type: 'vector' }) vec!: number[];
    }
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, VectorItem, {
        $select: { id: true },
        $sort: { vec: { $vector: [1, 2, 3] } },
        $limit: 10,
      }),
    );
    expect(sql).toBe('SELECT "id" FROM "VectorItem" ORDER BY "vec" <=> $1::vector LIMIT 10');
    expect(values).toEqual(['[1,2,3]']);
  }

  shouldSortByVectorSimilarityExplicitL2() {
    @Entity({ name: 'VectorItem' })
    class VectorItem {
      @Id() id?: number;
      @Field({ type: 'vector' }) vec!: number[];
    }
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, VectorItem, {
        $select: { id: true },
        $sort: { vec: { $vector: [1, 2, 3], $distance: 'l2' } },
        $limit: 5,
      }),
    );
    expect(sql).toBe('SELECT "id" FROM "VectorItem" ORDER BY "vec" <-> $1::vector LIMIT 5');
    expect(values).toEqual(['[1,2,3]']);
  }

  shouldSortByVectorSimilarityCombinedWithRegularSort() {
    @Entity({ name: 'VectorItem' })
    class VectorItem {
      @Id() id?: number;
      @Field({ type: 'vector' }) vec!: number[];
      @Field() name!: string;
    }
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, VectorItem, {
        $select: { id: true },
        $where: { name: 'test' },
        $sort: { vec: { $vector: [1, 2, 3] }, name: -1 },
        $limit: 10,
      }),
    );
    expect(sql).toBe(
      'SELECT "id" FROM "VectorItem" WHERE "name" = $1 ORDER BY "vec" <=> $2::vector, "name" DESC LIMIT 10',
    );
    expect(values).toEqual(['test', '[1,2,3]']);
  }

  shouldSortByVectorSimilarityWithEntityDefaultDistance() {
    @Entity({ name: 'VectorItem' })
    class VectorItem {
      @Id() id?: number;
      @Field({ type: 'vector', distance: 'inner' }) vec!: number[];
    }
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, VectorItem, {
        $select: { id: true },
        $sort: { vec: { $vector: [1, 2, 3] } },
        $limit: 10,
      }),
    );
    expect(sql).toBe('SELECT "id" FROM "VectorItem" ORDER BY "vec" <#> $1::vector LIMIT 10');
    expect(values).toEqual(['[1,2,3]']);
  }

  shouldProjectVectorDistance() {
    @Entity({ name: 'VectorItem' })
    class VectorItem {
      @Id() id?: number;
      @Field({ type: 'vector' }) vec!: number[];
    }
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, VectorItem, {
        $select: { id: true },
        $sort: { vec: { $vector: [1, 2, 3], $project: 'similarity' } },
        $limit: 10,
      }),
    );
    expect(sql).toBe(
      'SELECT "id", "vec" <=> $1::vector AS "similarity" FROM "VectorItem" ORDER BY "similarity" LIMIT 10',
    );
    expect(values).toEqual(['[1,2,3]']);
  }

  shouldCastHalfvecSort() {
    @Entity({ name: 'HalfvecItem' })
    class HalfvecItem {
      @Id() id?: number;
      @Field({ type: 'halfvec' }) vec!: number[];
    }
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, HalfvecItem, {
        $select: { id: true },
        $sort: { vec: { $vector: [1, 2, 3] } },
        $limit: 5,
      }),
    );
    expect(sql).toBe('SELECT "id" FROM "HalfvecItem" ORDER BY "vec" <=> $1::halfvec LIMIT 5');
    expect(values).toEqual(['[1,2,3]']);
  }

  shouldCastSparsevecSort() {
    @Entity({ name: 'SparsevecItem' })
    class SparsevecItem {
      @Id() id?: number;
      @Field({ type: 'sparsevec' }) vec!: number[];
    }
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, SparsevecItem, {
        $select: { id: true },
        $sort: { vec: { $vector: [0, 0, 1], $distance: 'l2' } },
        $limit: 5,
      }),
    );
    expect(sql).toBe('SELECT "id" FROM "SparsevecItem" ORDER BY "vec" <-> $1::sparsevec LIMIT 5');
    expect(values).toEqual(['[0,0,1]']);
  }

  shouldEscape() {
    expect(this.dialect.escape("it's")).toBe("'it''s'");
  }

  /** Array text format (`{...}`) is distinct from scalar SQL string literals; see `toPgArray` JSDoc. */
  shouldNormalizeArrayToPostgresArrayTextFormatWhenNativeArraysFalse() {
    const d = new PostgresDialect({ driverCapabilities: { nativeArrays: false } });
    const tricky = 'b"\\'; // b, double-quote, one backslash
    const escaped = tricky.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    expect(d.normalizeValue(['a', tricky, null])).toBe(`{"a","${escaped}",NULL}`);
    expect(d.normalizeValue([[1, 2], 3])).toBe('{{"1","2"},"3"}');
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
    expect(res.sql).toContain("elem->>'tag' <> ALL($2)");
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
      'UPDATE "Company" SET "kind" = COALESCE("kind", \'{}\'::jsonb) || $1::jsonb, "updatedAt" = $2 WHERE "id" = $3',
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
      'UPDATE "Company" SET "kind" = (COALESCE("kind", \'{}\'::jsonb) || $1::jsonb) - \'public\', "updatedAt" = $2 WHERE "id" = $3',
    );
    expect(values).toEqual(['{"private":1}', 123, 1]);
  }

  shouldUpdateWithJsonMergePushCombined() {
    const payload = { $merge: { private: 1 }, $push: { tags: 'new-tag' } };
    const updatedAt = 123;
    // Standard
    let res = this.exec((ctx) =>
      this.dialect.update(ctx, Company, { $where: { id: 1 } }, { kind: payload as any, updatedAt }),
    );
    expect(res.sql).toBe(
      'UPDATE "Company" SET "kind" = jsonb_set(COALESCE("kind", \'{}\'::jsonb) || $1::jsonb, \'{tags}\', COALESCE((COALESCE("kind", \'{}\'::jsonb) || $1::jsonb)->\'tags\', \'[]\'::jsonb) || jsonb_build_array($2::jsonb)), "updatedAt" = $3 WHERE "id" = $4',
    );
    expect(res.values).toEqual(['{"private":1}', '"new-tag"', 123, 1]);

    // Bun SQL Postgres
    res = this.exec(
      (ctx) =>
        this.bunSqlPostgresDialect.update(ctx, Company, { $where: { id: 1 } }, { kind: payload as any, updatedAt }),
      this.bunSqlPostgresDialect,
    );
    expect(res.sql).toBe(
      'UPDATE "Company" SET "kind" = jsonb_set(COALESCE("kind", \'{}\'::jsonb) || ($1::text)::jsonb, \'{tags}\', COALESCE((COALESCE("kind", \'{}\'::jsonb) || ($1::text)::jsonb)->\'tags\', \'[]\'::jsonb) || jsonb_build_array(($2::text)::jsonb)), "updatedAt" = $3 WHERE "id" = $4',
    );
    expect(res.values).toEqual(['{"private":1}', '"new-tag"', 123, 1]);
  }

  shouldUpdateWithJsonMergePushSameKey() {
    const payload = { $merge: { tags: ['a'] }, $push: { tags: 'b' } };
    const updatedAt = 123;
    // Standard
    let res = this.exec((ctx) =>
      this.dialect.update(ctx, Company, { $where: { id: 1 } }, { kind: payload as any, updatedAt }),
    );
    expect(res.sql).toBe(
      'UPDATE "Company" SET "kind" = jsonb_set(COALESCE("kind", \'{}\'::jsonb) || $1::jsonb, \'{tags}\', COALESCE((COALESCE("kind", \'{}\'::jsonb) || $1::jsonb)->\'tags\', \'[]\'::jsonb) || jsonb_build_array($2::jsonb)), "updatedAt" = $3 WHERE "id" = $4',
    );
    expect(res.values).toEqual(['{"tags":["a"]}', '"b"', 123, 1]);

    // Bun SQL Postgres
    res = this.exec(
      (ctx) =>
        this.bunSqlPostgresDialect.update(ctx, Company, { $where: { id: 1 } }, { kind: payload as any, updatedAt }),
      this.bunSqlPostgresDialect,
    );
    expect(res.sql).toBe(
      'UPDATE "Company" SET "kind" = jsonb_set(COALESCE("kind", \'{}\'::jsonb) || ($1::text)::jsonb, \'{tags}\', COALESCE((COALESCE("kind", \'{}\'::jsonb) || ($1::text)::jsonb)->\'tags\', \'[]\'::jsonb) || jsonb_build_array(($2::text)::jsonb)), "updatedAt" = $3 WHERE "id" = $4',
    );
    expect(res.values).toEqual(['{"tags":["a"]}', '"b"', 123, 1]);
  }

  shouldUpdateWithJsonPush() {
    const payload = { $push: { tags: 'a' } };
    const updatedAt = 123;
    // Standard
    let res = this.exec((ctx) =>
      this.dialect.update(ctx, Company, { $where: { id: 1 } }, { kind: payload as any, updatedAt }),
    );
    expect(res.sql).toBe(
      'UPDATE "Company" SET "kind" = jsonb_set("kind", \'{tags}\', COALESCE(("kind")->\'tags\', \'[]\'::jsonb) || jsonb_build_array($1::jsonb)), "updatedAt" = $2 WHERE "id" = $3',
    );
    expect(res.values).toEqual(['"a"', 123, 1]);

    // Bun SQL Postgres
    res = this.exec(
      (ctx) =>
        this.bunSqlPostgresDialect.update(ctx, Company, { $where: { id: 1 } }, { kind: payload as any, updatedAt }),
      this.bunSqlPostgresDialect,
    );
    expect(res.sql).toBe(
      'UPDATE "Company" SET "kind" = jsonb_set("kind", \'{tags}\', COALESCE(("kind")->\'tags\', \'[]\'::jsonb) || jsonb_build_array(($1::text)::jsonb)), "updatedAt" = $2 WHERE "id" = $3',
    );
    expect(res.values).toEqual(['"a"', 123, 1]);
  }

  shouldUpdateWithJsonPushUnsetCombined() {
    const payload = { $push: { tags: 'a' }, $unset: ['public'] };
    const updatedAt = 123;
    // Standard
    let res = this.exec((ctx) =>
      this.dialect.update(ctx, Company, { $where: { id: 1 } }, { kind: payload as any, updatedAt }),
    );
    expect(res.sql).toBe(
      'UPDATE "Company" SET "kind" = (jsonb_set("kind", \'{tags}\', COALESCE(("kind")->\'tags\', \'[]\'::jsonb) || jsonb_build_array($1::jsonb))) - \'public\', "updatedAt" = $2 WHERE "id" = $3',
    );
    expect(res.values).toEqual(['"a"', 123, 1]);

    // Bun SQL Postgres
    res = this.exec(
      (ctx) =>
        this.bunSqlPostgresDialect.update(ctx, Company, { $where: { id: 1 } }, { kind: payload as any, updatedAt }),
      this.bunSqlPostgresDialect,
    );
    expect(res.sql).toBe(
      'UPDATE "Company" SET "kind" = (jsonb_set("kind", \'{tags}\', COALESCE(("kind")->\'tags\', \'[]\'::jsonb) || jsonb_build_array(($1::text)::jsonb))) - \'public\', "updatedAt" = $2 WHERE "id" = $3',
    );
    expect(res.values).toEqual(['"a"', 123, 1]);
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

  shouldFormatPgArrayWithBinary() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { id: { $in: [new Uint8Array([1, 2, 3])] } as any },
      }),
    );
    expect(sql).toBe('SELECT "id" FROM "User" WHERE "id" = ANY($1)');
    expect(values).toEqual([[new Uint8Array([1, 2, 3])]]);
  }
}

createSpec(new PostgresDialectSpec());
