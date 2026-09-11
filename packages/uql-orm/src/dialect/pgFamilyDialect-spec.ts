import { expect } from 'vitest';
import { Entity, Field, Id, Index } from '../entity/index.js';
import {
  anyUuid,
  Company,
  Item,
  ItemTag,
  MeasureUnitCategory,
  Profile,
  Tax,
  TaxCategory,
  User,
  UserWithNonUpdatableId,
} from '../test/index.js';
import type { UpdatePayload } from '../type/index.js';
import { raw } from '../util/index.js';
import { AbstractSqlDialectSpec, type JsonUpdateCaseName } from './abstractSqlDialect-spec.js';

/**
 * Shared expectations for the Postgres-wire dialects (PostgreSQL, CockroachDB): `$n` placeholders,
 * `ON CONFLICT` upserts, `= ANY($1)` sets, the `jsonb` operators, `BEGIN [ISOLATION LEVEL ...]`.
 *
 * A family suite rather than a Postgres one CockroachDB happens to skip: it ran none of these before,
 * so everything its dialect shares with Postgres - which is nearly all of it - was only ever checked
 * against a live server. `MySqlFamilySpec` is the same shape for MySQL and MariaDB.
 */
export abstract class PgFamilySpec extends AbstractSqlDialectSpec {
  /**
   * Postgres reports insert-vs-update from `xmax`, a system column CockroachDB does not have, so its
   * upserts return the id alone. The only difference between the two in this whole suite.
   */
  protected readonly upsertCreatedFlag: string = ', (xmax = 0) AS "_created"';

  override shouldBeValidEscapeCharacter() {
    expect(this.dialect.escapeIdChar).toBe('"');
  }

  override shouldBeginTransaction() {
    expect(this.dialect.beginTransactionCommand).toBe('BEGIN');
  }

  override shouldGetBeginTransactionStatementsWithoutIsolationLevel() {
    expect(this.dialect.getBeginTransactionStatements()).toEqual(['BEGIN']);
  }

  /** Neither runs `FOR UPDATE` beside a window function, so a locked paged read takes two. */
  shouldNotRunAWindowUnderARowLock() {
    expect(this.dialect.supportsWindowWithRowLock).toBe(false);
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

  override shouldInsertMany() {
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
      'INSERT INTO "User" ("name", "email", "createdAt", "id") VALUES ($1, $2, $3, $4), ($5, $6, $7, $8), ($9, $10, $11, $12) RETURNING "id" "id"',
    );
    expect(values).toEqual([
      'Some name 1',
      'someemail1@example.com',
      123,
      anyUuid,
      'Some name 2',
      'someemail2@example.com',
      456,
      anyUuid,
      'Some name 3',
      'someemail3@example.com',
      789,
      anyUuid,
    ]);
  }

  /**
   * A mixed batch: columns are the union across records (first-seen order), an explicit id is kept,
   * and any column a record omits (the missing id in row 2, the missing email in row 1) inserts its
   * database default.
   */

  /**
   * A mixed batch: columns are the union across records (first-seen order), an explicit id is kept,
   * and any column a record omits (the missing id in row 2, the missing email in row 1) inserts its
   * database default.
   */
  override shouldInsertManyWithHeterogeneousColumns() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.insert(ctx, User, [
        { id: '5', name: 'Some name 1', createdAt: 123 },
        { name: 'Some name 2', email: 'someemail2@example.com', createdAt: 456 },
      ]),
    );
    expect(sql).toBe(
      'INSERT INTO "User" ("id", "name", "createdAt", "email") VALUES ($1, $2, $3, DEFAULT), ($4, $5, $6, $7) RETURNING "id" "id"',
    );
    expect(values).toEqual(['5', 'Some name 1', 123, anyUuid, 'Some name 2', 456, 'someemail2@example.com']);
  }

  override shouldInsertOne() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.insert(ctx, User, {
        name: 'Some Name',
        email: 'someemail@example.com',
        createdAt: 123,
      }),
    );
    expect(sql).toBe(
      'INSERT INTO "User" ("name", "email", "createdAt", "id") VALUES ($1, $2, $3, $4) RETURNING "id" "id"',
    );
    expect(values).toEqual(['Some Name', 'someemail@example.com', 123, anyUuid]);
  }

  override shouldInsertWithOnInsertId() {
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

  override shouldUpsert() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        User,
        { id: true },
        {
          id: '1',
          name: 'Some Name',
          createdAt: 123,
        },
      ),
    );
    expect(sql).toBe(
      `INSERT INTO "User" ("id", "name", "createdAt") VALUES ($2, $3, $4) ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "createdAt" = EXCLUDED."createdAt", "updatedAt" = $1 RETURNING "id" "id"${this.upsertCreatedFlag}`,
    );
    expect(values).toEqual([expect.any(Number), '1', 'Some Name', 123]);
  }

  override shouldUpsertMany() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(ctx, User, { id: true }, [
        {
          id: '1',
          name: 'Name A',
          createdAt: 100,
        },
        {
          id: '2',
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

  /**
   * Regression: each fallback (non-`EXCLUDED`) update column formats its value in an isolated
   * context that always numbered its own placeholder from `$1` - correct only by coincidence when a
   * single such column existed. With two, both rendered `$1` while the values landed at different
   * positions, so the second column silently bound the wrong value.
   */

  /**
   * Regression: each fallback (non-`EXCLUDED`) update column formats its value in an isolated
   * context that always numbered its own placeholder from `$1` - correct only by coincidence when a
   * single such column existed. With two, both rendered `$1` while the values landed at different
   * positions, so the second column silently bound the wrong value.
   */
  shouldUpsertWithTwoFallbackUpdateColumns() {
    @Entity({ name: 'UpsertFallbackWidget' })
    class UpsertFallbackWidget {
      @Id({ type: Number }) id?: number;
      @Field({ type: String }) email!: string;
      @Field({ type: Number, onUpdate: () => 111 }) updatedAt?: number;
      @Field({ type: String, onUpdate: () => 'v2' }) version?: string;
    }

    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(ctx, UpsertFallbackWidget, { email: true }, { email: 'a@b.com' }),
    );
    expect(sql).toBe(
      `INSERT INTO "UpsertFallbackWidget" ("email") VALUES ($3) ON CONFLICT ("email") DO UPDATE SET "updatedAt" = $1, "version" = $2 RETURNING "id" "id"${this.upsertCreatedFlag}`,
    );
    expect(values).toEqual([111, 'v2', 'a@b.com']);
  }

  /** A RETURNING clause on every insert, unlike the base's `firstId` (MySQL) expectation. */

  /** A RETURNING clause on every insert, unlike the base's `firstId` (MySQL) expectation. */
  override shouldInsertManyWithSpecifiedIdsAndOnInsertIdAsDefault() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.insert(ctx, TaxCategory, [
        { name: 'Some Name A' },
        { pk: '50', name: 'Some Name B' },
        { name: 'Some Name C' },
        { pk: '70', name: 'Some Name D' },
      ]),
    );
    expect(sql).toMatch(
      /^INSERT INTO "TaxCategory" \("name", "createdAt", "pk"\) VALUES \(\$1, \$2, \$3\), \(\$4, \$5, \$6\), \(\$7, \$8, \$9\), \(\$10, \$11, \$12\) RETURNING "pk" "id"$/,
    );
    expect(values[0]).toBe('Some Name A');
    expect(values[2]).toMatch(/.+/);
    expect(values[3]).toBe('Some Name B');
    expect(values[5]).toBe('50');
  }

  /** Postgres/CockroachDB's numbered placeholders, unlike MySQL's positionless `?`. */

  /** Postgres/CockroachDB's numbered placeholders, unlike MySQL's positionless `?`. */
  override shouldBeSecure() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true, something: true } as any,
        $where: {
          id: 1,
          something: 1,
        } as any,
        $sort: {
          id: 1,
          something: 1,
        } as any,
      }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "User" WHERE "id" = $1 AND "something" = $2 ORDER BY "id", "something"');
    expect(res.values).toEqual([1, 1]);

    res = this.exec((ctx) =>
      this.dialect.insert(ctx, User, {
        name: 'Some Name',
        something: 'anything',
        createdAt: 1,
      } as any),
    );
    expect(res.sql).toBe('INSERT INTO "User" ("name", "createdAt", "id") VALUES ($1, $2, $3) RETURNING "id" "id"');
    expect(res.values).toEqual(['Some Name', 1, anyUuid]);

    res = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        User,
        {
          $where: { something: 'anything' } as any,
        },
        {
          name: 'Some Name',
          something: 'anything',
          updatedAt: 1,
        } as any,
      ),
    );
    expect(res.sql).toBe('UPDATE "User" SET "name" = $1, "updatedAt" = $2 WHERE "something" = $3');
    expect(res.values).toEqual(['Some Name', 1, 'anything']);

    res = this.exec((ctx) =>
      this.dialect.delete(ctx, User, {
        $where: { something: 'anything' } as any,
      }),
    );
    expect(res.sql).toBe('DELETE FROM "User" WHERE "something" = $1');
    expect(res.values).toEqual(['anything']);
  }

  /** `$in`/array-membership binds as a single native array via `= ANY(...)`, not `IN (?, ?, ...)`. */

  /** `$in`/array-membership binds as a single native array via `= ANY(...)`, not `IN (?, ?, ...)`. */
  override shouldFind$in() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: 'some', companyId: ['1', '2', '3'] },
        $limit: 10,
      }),
    );
    expect(res.sql).toBe(`SELECT "id" FROM "User" WHERE "name" = $1 AND "companyId" = ANY($2)${this.pgr(10)}`);
    expect(res.values).toEqual(['some', ['1', '2', '3']]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: 'some', companyId: { $in: ['1', '2', '3'] } },
        $limit: 10,
      }),
    );
    expect(res.sql).toBe(`SELECT "id" FROM "User" WHERE "name" = $1 AND "companyId" = ANY($2)${this.pgr(10)}`);
    expect(res.values).toEqual(['some', ['1', '2', '3']]);
  }

  /** Same `$or`/`$and` composition as the base, but `$in` shorthand binds via `= ANY(...)`. */

  /** Same `$or`/`$and` composition as the base, but `$in` shorthand binds via `= ANY(...)`. */
  override shouldFind$orAnd$and() {
    const res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { creatorId: '1', $or: [{ name: ['a', 'b', 'c'] }, { email: 'abc@example.com' }], id: '1' },
      }),
    );
    expect(res.sql).toBe(
      'SELECT "id" FROM "User" WHERE "creatorId" = $1 AND ("name" = ANY($2) OR "email" = $3) AND "id" = $4',
    );
    expect(res.values).toEqual(['1', ['a', 'b', 'c'], 'abc@example.com', '1']);

    const res2 = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: {
          creatorId: '1',
          $or: [{ name: ['a', 'b', 'c'] }, { email: 'abc@example.com' }],
          id: '1',
          email: 'e',
        },
      }),
    );
    expect(res2.sql).toBe(
      'SELECT "id" FROM "User" WHERE "creatorId" = $1' +
        ' AND ("name" = ANY($2) OR "email" = $3) AND "id" = $4 AND "email" = $5',
    );
    expect(res2.values).toEqual(['1', ['a', 'b', 'c'], 'abc@example.com', '1', 'e']);

    const res3 = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: {
          creatorId: '1',
          $or: [{ name: ['a', 'b', 'c'] }, { email: 'abc@example.com' }],
          id: '1',
          email: 'e',
        },
        $sort: { name: 1, createdAt: -1 },
        $skip: 50,
        $limit: 10,
      }),
    );
    expect(res3.sql).toBe(
      'SELECT "id" FROM "User" WHERE "creatorId" = $1' +
        ' AND ("name" = ANY($2) OR "email" = $3)' +
        ' AND "id" = $4 AND "email" = $5' +
        ` ORDER BY "name", "createdAt" DESC${this.pgr(10, 50, true)}`,
    );
    expect(res3.values).toEqual(['1', ['a', 'b', 'c'], 'abc@example.com', '1', 'e']);

    const res4 = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: {
          $or: [
            {
              creatorId: '1',
              id: '1',
              email: 'e',
            },
            { name: ['a', 'b', 'c'], email: 'abc@example.com' },
          ],
        },
        $sort: { name: 'asc', createdAt: 'desc' },
        $skip: 50,
        $limit: 10,
      }),
    );
    expect(res4.sql).toBe(
      'SELECT "id" FROM "User" WHERE ("creatorId" = $1 AND "id" = $2 AND "email" = $3)' +
        ' OR ("name" = ANY($4) AND "email" = $5)' +
        ` ORDER BY "name", "createdAt" DESC${this.pgr(10, 50, true)}`,
    );
    expect(res4.values).toEqual(['1', '1', 'e', ['a', 'b', 'c'], 'abc@example.com']);
  }

  /** The `$in` sub-case binds via `= ANY(...)`, unlike the base's `IN (?, ?)`. */

  /** The `$in` sub-case binds via `= ANY(...)`, unlike the base's `IN (?, ?)`. */
  override shouldFind$whereRaw() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { creatorId: true },
        $where: { $and: [{ companyId: '1' }, raw`SUM(salePrice) > 500`] },
      }),
    );
    expect(res.sql).toBe('SELECT "creatorId" FROM "Item" WHERE "companyId" = $1 AND SUM(salePrice) > 500');
    expect(res.values).toEqual(['1']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { $or: [{ companyId: '1' }, { id: '5' }, raw`SUM(salePrice) > 500`] },
      }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "Item" WHERE "companyId" = $1 OR "id" = $2 OR SUM(salePrice) > 500');
    expect(res.values).toEqual(['1', '5']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { $or: [{ id: '1' }, raw`SUM(salePrice) > 500`] },
      }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "Item" WHERE "id" = $1 OR SUM(salePrice) > 500');
    expect(res.values).toEqual(['1']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { $or: [raw`SUM(salePrice) > 500`, { id: '1' }, { companyId: '1' }] },
      }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "Item" WHERE SUM(salePrice) > 500 OR "id" = $1 OR "companyId" = $2');
    expect(res.values).toEqual(['1', '1']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { $and: [raw`SUM(salePrice) > 500`] },
      }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "Item" WHERE SUM(salePrice) > 500');

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { creatorId: true },
        $where: { $or: [{ id: { $in: ['1', '2'] } }, { code: 'abc' }] },
      }),
    );
    expect(res.sql).toBe('SELECT "creatorId" FROM "Item" WHERE "id" = ANY($1) OR "code" = $2');
    expect(res.values).toEqual([['1', '2'], 'abc']);
  }

  /** `$not` on an array value goes through the same `= ANY(...)` array binding as `$in`. */

  /** `$not` on an array value goes through the same `= ANY(...)` array binding as `$in`. */
  override shouldFind$not() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { $not: [{ name: 'Some' }] },
      }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "User" WHERE NOT "name" = $1');
    expect(res.values).toEqual(['Some']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { id: { $not: '123' } },
      }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "Company" WHERE NOT ("id" = $1)');
    expect(res.values).toEqual(['123']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { id: { $not: ['123', '456'] } },
      }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "Company" WHERE NOT ("id" = ANY($1))');
    expect(res.values).toEqual([['123', '456']]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { id: '123', name: { $not: { $startsWith: 'a' } } },
      }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "Company" WHERE "id" = $1 AND NOT ("name" LIKE $2)');
    expect(res.values).toEqual(['123', 'a%']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { name: { $not: { $startsWith: 'a', $endsWith: 'z' } } },
      }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "Company" WHERE NOT (("name" LIKE $1 AND "name" LIKE $2))');
    expect(res.values).toEqual(['a%', '%z']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { $not: [{ name: { $like: 'Some', $ne: 'Something' } }] },
      }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "User" WHERE NOT ("name" LIKE $1 AND "name" IS DISTINCT FROM $2)');
    expect(res.values).toEqual(['Some', 'Something']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { $not: [{ name: 'abc' }, { creatorId: '1' }] },
      }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "User" WHERE NOT ("name" = $1 AND "creatorId" = $2)');
    expect(res.values).toEqual(['abc', '1']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Tax, {
        $select: { id: true },
        $where: { companyId: '1', name: { $not: { $startsWith: 'a' } } },
      }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "Tax" WHERE "companyId" = $1 AND NOT ("name" LIKE $2)');
    expect(res.values).toEqual(['1', 'a%']);
  }

  /** A JSONB column always binds with an explicit cast, even for `null`. */

  /** A JSONB column always binds with an explicit cast, even for `null`. */
  override shouldUpdateWithJsonNull() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        Company,
        { $where: { id: '1' } },
        {
          kind: null as any,
          updatedAt: 123,
        },
      ),
    );
    expect(sql).toBe('UPDATE "Company" SET "kind" = $1::jsonb, "updatedAt" = $2 WHERE "id" = $3');
    expect(values).toEqual([null, 123, '1']);
  }

  /** `$in`/`$nin` inside `$having` also bind as a native array via `= ANY`/`<> ALL`. */

  /** `$in`/`$nin` inside `$having` also bind as a native array via `= ANY`/`<> ALL`. */
  override shouldAggregateWithHavingIn() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $select: { count: { $count: '*' } },
        $having: { count: { $in: [1, 5, 10] } },
      }),
    );
    expect(sql).toContain('HAVING COUNT(*) = ANY(');
    expect(values).toEqual([[1, 5, 10]]);
  }

  override shouldAggregateWithHavingNin() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: { name: true },
        $select: { count: { $count: '*' } },
        $having: { count: { $nin: [0, 999] } },
      }),
    );
    expect(sql).toContain('HAVING COUNT(*) <> ALL(');
    expect(values).toEqual([[0, 999]]);
  }

  shouldUpsertWithDifferentColumnNames() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        Profile,
        { pk: true },
        {
          pk: '1',
          picture: 'image.jpg',
        },
      ),
    );
    expect(sql).toBe(
      `INSERT INTO "user_profile" ("pk", "image", "createdAt") VALUES ($2, $3, $4) ON CONFLICT ("pk") DO UPDATE SET "image" = EXCLUDED."image", "updatedAt" = $1 RETURNING "pk" "id"${this.upsertCreatedFlag}`,
    );
    expect(values).toEqual([expect.any(Number), '1', 'image.jpg', expect.any(Number)]);
  }

  shouldUpsertWithNonUpdatableFields() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        User,
        { id: true },
        {
          id: '1',
          email: 'a@b.com',
        },
      ),
    );
    expect(sql).toBe(
      `INSERT INTO "User" ("id", "email", "createdAt") VALUES ($2, $3, $4) ON CONFLICT ("id") DO UPDATE SET "updatedAt" = $1 RETURNING "id" "id"${this.upsertCreatedFlag}`,
    );
    expect(values).toEqual([expect.any(Number), '1', 'a@b.com', expect.any(Number)]);
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
      `INSERT INTO "UserWithNonUpdatableId" ("id", "name") VALUES ($1, $2) ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name" RETURNING "id" "id"${this.upsertCreatedFlag}`,
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
          id: '1',
        },
      ),
    );
    expect(sql).toBe(
      `INSERT INTO "ItemTag" ("id") VALUES ($1) ON CONFLICT ("id") DO NOTHING RETURNING "id" "id"${this.upsertCreatedFlag}`,
    );
    expect(values).toEqual(['1']);
  }

  shouldUpsertWithCompositeKeys() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        ItemTag,
        { itemId: true, tagId: true },
        {
          itemId: '1',
          tagId: '2',
        },
      ),
    );
    expect(sql).toBe(
      `INSERT INTO "ItemTag" ("itemId", "tagId", "id") VALUES ($1, $2, $3) ON CONFLICT ("itemId", "tagId") DO NOTHING RETURNING "id" "id"${this.upsertCreatedFlag}`,
    );
    expect(values).toEqual(['1', '2', anyUuid]);
  }

  shouldUpsertWithOnUpdateField() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        User,
        { id: true },
        {
          id: '1',
          name: 'Some Name',
        },
      ),
    );
    expect(sql).toMatch(
      /^INSERT INTO "User" \(.*"id".*"name".*"createdAt".*\) VALUES \(.*\$2, \$3, \$4.*\) ON CONFLICT \("id"\) DO UPDATE SET .*"name" = EXCLUDED."name".*"updatedAt" = \$1.*$/,
    );
    expect(values).toEqual([expect.any(Number), '1', 'Some Name', expect.any(Number)]);
  }

  shouldUpsertWithComputedField() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        Item,
        { id: true },
        {
          id: '1',
          name: 'Some Item',
          tagsCount: 5,
        },
      ),
    );
    expect(sql).toBe(
      `INSERT INTO "Item" ("id", "name", "createdAt") VALUES ($2, $3, $4) ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "updatedAt" = $1 RETURNING "id" "id"${this.upsertCreatedFlag}`,
    );
    expect(values).toEqual([expect.any(Number), '1', 'Some Item', expect.any(Number)]);
  }

  override shouldFind$regex() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $regex: '^some' } },
      }),
    );
    expect(sql).toBe('SELECT "id" FROM "User" WHERE "name" ~ $1');
    expect(values).toEqual(['^some']);
  }

  override shouldFind$text() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { $text: { $fields: { name: true, description: true }, $value: 'some text' }, code: '1' },
        $limit: 30,
      }),
    );
    expect(res.sql).toBe(
      `SELECT "id" FROM "Item" WHERE TO_TSVECTOR("name" || ' ' || "description") @@ WEBSEARCH_TO_TSQUERY($1) AND "code" = $2${this.pgr(30)}`,
    );
    expect(res.values).toEqual(['some text', '1']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: {
          $text: { $fields: { name: true }, $value: 'something' },
          name: { $ne: 'other unwanted' },
          creatorId: '1',
        },
        $limit: 10,
      }),
    );
    expect(res.sql).toBe(
      `SELECT "id" FROM "User" WHERE TO_TSVECTOR("name") @@ WEBSEARCH_TO_TSQUERY($1) AND "name" IS DISTINCT FROM $2 AND "creatorId" = $3${this.pgr(10)}`,
    );
    expect(res.values).toEqual(['something', 'other unwanted', '1']);
  }

  override shouldUpdateWithRawString() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        Company,
        { $where: { id: '1' } },
        {
          kind: raw`jsonb_set(kind, '{open}', to_jsonb(1))`,
          updatedAt: 123,
        },
      ),
    );
    expect(sql).toBe(
      'UPDATE "Company" SET "kind" = jsonb_set(kind, \'{open}\', to_jsonb(1)), "updatedAt" = $1 WHERE "id" = $2',
    );
    expect(values).toEqual([123, '1']);
  }

  shouldFormatVector() {
    @Entity({ name: 'VectorItem' })
    class VectorItem {
      @Id({ type: Number }) id?: number;
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

  /** Array text format (`{...}`) is distinct from scalar SQL string literals; see `toPgArray` JSDoc. */

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
    expect(sql).toBe('SELECT "id" FROM "Company" WHERE JSONB_ARRAY_LENGTH("kind") = $1');
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
    expect(res.sql).toBe('SELECT "id" FROM "Company" WHERE JSONB_ARRAY_LENGTH("kind") >= $1');
    expect(res.values).toEqual([2]);

    // Multiple comparison operators
    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { kind: { $size: { $gt: 0, $lte: 5 } } } as any,
      }),
    );
    expect(res.sql).toBe(
      'SELECT "id" FROM "Company" WHERE (JSONB_ARRAY_LENGTH("kind") > $1 AND JSONB_ARRAY_LENGTH("kind") <= $2)',
    );
    expect(res.values).toEqual([0, 5]);

    // $between
    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { kind: { $size: { $between: [1, 10] } } } as any,
      }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "Company" WHERE JSONB_ARRAY_LENGTH("kind") BETWEEN $1 AND $2');
    expect(res.values).toEqual([1, 10]);
  }

  /**
   * Regression: `jsonSize` builds its comparison in an isolated context, which always numbers its
   * own placeholders from `$1` - only correct by coincidence when `$size` is the sole bound value.
   * With a preceding condition, the placeholder must shift to account for it.
   */

  /**
   * Regression: `jsonSize` builds its comparison in an isolated context, which always numbers its
   * own placeholders from `$1` - only correct by coincidence when `$size` is the sole bound value.
   * With a preceding condition, the placeholder must shift to account for it.
   */
  shouldFind$sizeAfterAnotherBoundValue() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { name: 'Acme', kind: { $size: 3 } } as any,
      }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "Company" WHERE "name" = $1 AND JSONB_ARRAY_LENGTH("kind") = $2');
    expect(res.values).toEqual(['Acme', 3]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { name: 'Acme', kind: { $size: { $gt: 0, $lte: 5 } } } as any,
      }),
    );
    expect(res.sql).toBe(
      'SELECT "id" FROM "Company" WHERE "name" = $1 AND (JSONB_ARRAY_LENGTH("kind") > $2 AND JSONB_ARRAY_LENGTH("kind") <= $3)',
    );
    expect(res.values).toEqual(['Acme', 0, 5]);
  }

  // Tests for $elemMatch with nested operators

  // Tests for $elemMatch with nested operators
  shouldFind$elemMatchWithOperators() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { kind: { $elemMatch: { city: { $ilike: 'new%' } } } } as any,
      }),
    );
    expect(sql).toBe(
      'SELECT "id" FROM "Company" WHERE EXISTS (SELECT 1 FROM JSONB_ARRAY_ELEMENTS("kind") AS _uql_elem WHERE _uql_elem->>\'city\' ILIKE $1)',
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
      'SELECT "id" FROM "Company" WHERE EXISTS (SELECT 1 FROM JSONB_ARRAY_ELEMENTS("kind") AS _uql_elem WHERE (_uql_elem->>\'price\')::numeric > $1 AND _uql_elem->\'active\' = $2::jsonb)',
    );
    // The boolean compares as JSON: extracting it as text loses the type.
    expect(values).toEqual([100, 'true']);
  }

  shouldFind$elemMatchWithMixedConditions() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { kind: { $elemMatch: { name: 'exact', status: { $in: ['active', 'pending'] } } } } as any,
      }),
    );
    expect(sql).toBe(
      'SELECT "id" FROM "Company" WHERE EXISTS (SELECT 1 FROM JSONB_ARRAY_ELEMENTS("kind") AS _uql_elem WHERE _uql_elem->>\'name\' = $1 AND _uql_elem->>\'status\' = ANY($2))',
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
      'SELECT "id" FROM "Company" WHERE EXISTS (SELECT 1 FROM JSONB_ARRAY_ELEMENTS("kind") AS _uql_elem WHERE _uql_elem->>\'name\' LIKE $1)',
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
    expect(res.sql).toContain("_uql_elem->>'status' IS DISTINCT FROM $1");

    // Test $gte, $lt, $lte
    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { kind: { $elemMatch: { qty: { $gte: 10 }, price: { $lt: 50 }, discount: { $lte: 20 } } } } as any,
      }),
    );
    expect(res.sql).toContain("(_uql_elem->>'qty')::numeric >= $1");
    expect(res.sql).toContain("(_uql_elem->>'price')::numeric < $2");
    expect(res.sql).toContain("(_uql_elem->>'discount')::numeric <= $3");

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
    expect(res.sql).toContain("_uql_elem->>'a' LIKE");
    expect(res.sql).toContain("_uql_elem->>'b' LIKE");
    expect(res.sql).toContain("_uql_elem->>'c' ILIKE");
    expect(res.sql).toContain("_uql_elem->>'d' ILIKE");
    expect(res.sql).toContain("_uql_elem->>'e' LIKE");
    expect(res.sql).toContain("_uql_elem->>'f' ILIKE");

    // Test $regex, $nin
    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { kind: { $elemMatch: { code: { $regex: '^A' }, tag: { $nin: ['x', 'y'] } } } } as any,
      }),
    );
    expect(res.sql).toContain("_uql_elem->>'code' ~ $1");
    expect(res.sql).toContain("_uql_elem->>'tag' <> ALL($2)");
  }

  // JSONB dot-notation tests (Postgres-specific)

  // JSONB dot-notation tests (Postgres-specific)
  shouldFindByJsonDotNotation() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { 'kind.public': 1 } as any,
      }),
    );
    expect(sql).toBe('SELECT "id" FROM "Company" WHERE (("kind"->>\'public\'))::numeric = $1');
    expect(values).toEqual([1]);
  }

  shouldFindByJsonDotNotationWithOperator() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { 'kind.private': { $ne: 0 } } as any,
      }),
    );
    expect(sql).toBe('SELECT "id" FROM "Company" WHERE (("kind"->>\'private\'))::numeric IS DISTINCT FROM $1');
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

  // ManyToMany relation filtering (Postgres-specific)
  shouldFindByManyToManyRelation() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { tags: { id: 5 } } as any,
      }),
    );
    expect(sql).toBe(
      'SELECT "id" FROM "Item" WHERE EXISTS (SELECT 1 FROM "ItemTag" WHERE "ItemTag"."itemId" = "Item"."id" AND "ItemTag"."tagId" IN (SELECT "tags"."id" FROM "Tag" "tags" WHERE "tags"."id" = $1))',
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
      'SELECT "id" FROM "MeasureUnitCategory" WHERE EXISTS (SELECT 1 FROM "MeasureUnit" "measureUnits" WHERE "measureUnits"."categoryId" = "MeasureUnitCategory"."id" AND "measureUnits"."name" = $1 AND "measureUnits"."deletedAt" IS NULL) AND "deletedAt" IS NULL',
    );
    expect(values).toEqual(['kg']);
  }

  /**
   * A to-many is read inside its parent's statement: an ordinary read under the relation's name, each row
   * aggregated whole through a LATERAL projection of the columns it answers under, so a sort term carried
   * out for the aggregate stays out of the object. A number crosses as text: JSON would round a BIGINT.
   */
  shouldReadAToManyInsideItsParentStatement() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, MeasureUnitCategory, {
        $select: { name: true },
        $populate: { measureUnits: { $select: { name: true, createdAt: true }, $sort: { name: 1 }, $limit: 5 } },
      }),
    );

    expect(sql).toBe(
      `SELECT "MeasureUnitCategory"."name", (SELECT COALESCE(JSON_AGG("_uql_row" ORDER BY "measureUnits"."_uql_sort_name"), '[]'::json)` +
        ' FROM (SELECT "measureUnits"."name", "measureUnits"."createdAt"::text "createdAt", "measureUnits"."name" "_uql_sort_name"' +
        ' FROM "MeasureUnit" "measureUnits" WHERE "measureUnits"."categoryId" = "MeasureUnitCategory"."id"' +
        ' AND "measureUnits"."deletedAt" IS NULL ORDER BY "_uql_sort_name" LIMIT 5) "measureUnits"' +
        ' CROSS JOIN LATERAL (SELECT "measureUnits"."name", "measureUnits"."createdAt") "_uql_row") "measureUnits"' +
        ' FROM "MeasureUnitCategory" WHERE "MeasureUnitCategory"."deletedAt" IS NULL',
    );
    expect(values).toEqual([]);
  }

  /** A many-to-many reads its targets, each once, through the junction rows pairing them to the parent. */
  shouldReadAManyToManyInsideItsParentStatement() {
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, Item, { $select: { name: true }, $populate: { tags: { $select: { name: true } } } }),
    );

    expect(sql).toBe(
      `SELECT "Item"."name", (SELECT COALESCE(JSON_AGG("_uql_row"), '[]'::json)` +
        ' FROM (SELECT "tags"."name" FROM "Tag" "tags" WHERE "tags"."id" IN' +
        ' (SELECT "ItemTag"."tagId" FROM "ItemTag" WHERE "ItemTag"."itemId" = "Item"."id")) "tags"' +
        ' CROSS JOIN LATERAL (SELECT "tags"."name") "_uql_row") "tags" FROM "Item"',
    );
  }

  /** A `$count` is the subquery a relation filter already counts with, aliased where the row reads it. */
  shouldCountARelationInsideItsParentStatement() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, MeasureUnitCategory, {
        $select: { name: true },
        $count: { measureUnits: { $where: { name: 'kg' } } },
      }),
    );

    expect(sql).toBe(
      'SELECT "name", (SELECT COUNT(*) FROM "MeasureUnit" "measureUnits" WHERE "measureUnits"."categoryId" = "MeasureUnitCategory"."id"' +
        ' AND "measureUnits"."name" = $1 AND "measureUnits"."deletedAt" IS NULL) "_count.measureUnits"' +
        ' FROM "MeasureUnitCategory" WHERE "deletedAt" IS NULL',
    );
    expect(values).toEqual(['kg']);
  }

  /** The child reads under the relation's name, so a self-reference compares it with its parent. */
  shouldReadASelfReferenceAgainstItsParent() {
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, User, { $select: { name: true }, $populate: { users: { $select: { name: true } } } }),
    );

    expect(sql).toBe(
      `SELECT "User"."name", (SELECT COALESCE(JSON_AGG("_uql_row"), '[]'::json)` +
        ' FROM (SELECT "users"."name" FROM "User" "users" WHERE "users"."creatorId" = "User"."id") "users"' +
        ' CROSS JOIN LATERAL (SELECT "users"."name") "_uql_row") "users" FROM "User"',
    );
  }

  /**
   * A child's to-one joins inside its own statement, and keeps its id there as a joined row always
   * does. Every table of the statement claims an alias of its own, so no join inside shadows the parent.
   */
  shouldJoinAToOneInsideAToMany() {
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, MeasureUnitCategory, {
        $select: { name: true },
        $populate: { measureUnits: { $select: { name: true }, $populate: { category: { $select: { name: true } } } } },
      }),
    );

    expect(sql).toBe(
      `SELECT "MeasureUnitCategory"."name", (SELECT COALESCE(JSON_AGG("_uql_row"), '[]'::json)` +
        ' FROM (SELECT "measureUnits"."name", "category"."id" "category.id", "category"."name" "category.name"' +
        ' FROM "MeasureUnit" "measureUnits" LEFT JOIN "MeasureUnitCategory" "category" ON "category"."id" = "measureUnits"."categoryId"' +
        ' AND "category"."deletedAt" IS NULL' +
        ' WHERE "measureUnits"."categoryId" = "MeasureUnitCategory"."id" AND "measureUnits"."deletedAt" IS NULL) "measureUnits"' +
        ' CROSS JOIN LATERAL (SELECT "measureUnits"."name", "measureUnits"."category.id", "measureUnits"."category.name") "_uql_row")' +
        ' "measureUnits" FROM "MeasureUnitCategory" WHERE "MeasureUnitCategory"."deletedAt" IS NULL',
    );
  }

  /** `json` has no equality, so a parent that deduplicates its rows compares the array as `jsonb`. */
  shouldCompareARelationAsJsonbUnderADistinctParent() {
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, MeasureUnitCategory, {
        $select: { name: true },
        $distinct: true,
        $populate: { measureUnits: { $select: { name: true } } },
      }),
    );

    expect(sql).toBe(
      `SELECT DISTINCT "MeasureUnitCategory"."name", (SELECT COALESCE(JSON_AGG("_uql_row"), '[]'::json)` +
        ' FROM (SELECT "measureUnits"."name" FROM "MeasureUnit" "measureUnits"' +
        ' WHERE "measureUnits"."categoryId" = "MeasureUnitCategory"."id" AND "measureUnits"."deletedAt" IS NULL) "measureUnits"' +
        ' CROSS JOIN LATERAL (SELECT "measureUnits"."name") "_uql_row")::jsonb "measureUnits"' +
        ' FROM "MeasureUnitCategory" WHERE "MeasureUnitCategory"."deletedAt" IS NULL',
    );
  }

  /**
   * The children correlate on the parent's key without selecting it, so the parent keeps only what the
   * query asked for, and each child crosses JSON with its numbers as text.
   */
  override shouldFind$excludeBesideAToMany() {
    const children =
      `(SELECT COALESCE(JSON_AGG("_uql_row"), '[]'::json) FROM (SELECT "users"."id", "users"."companyId",` +
      ' "users"."creatorId", "users"."createdAt"::text "createdAt", "users"."updatedAt"::text "updatedAt",' +
      ' "users"."name", "users"."email" FROM "User" "users" WHERE "users"."creatorId" = "User"."id") "users"' +
      ' CROSS JOIN LATERAL (SELECT "users"."id", "users"."companyId", "users"."creatorId", "users"."createdAt",' +
      ' "users"."updatedAt", "users"."name", "users"."email") "_uql_row") "users"';
    const expected =
      'SELECT "User"."companyId", "User"."creatorId", "User"."createdAt", "User"."updatedAt",' +
      ` "User"."name", "User"."email", ${children} FROM "User"`;

    expect(
      this.exec((ctx) => this.dialect.find(ctx, User, { $exclude: { id: true }, $populate: { users: true } })).sql,
    ).toBe(expected);
    expect(
      this.exec((ctx) => this.dialect.find(ctx, User, { $select: { id: false }, $populate: { users: true } })).sql,
    ).toBe(expected);
  }

  /** The rows of each parent are ordered and paged inside their own subquery. */
  override shouldPageAToManyRelation() {
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $populate: { tags: { $select: { name: true }, $sort: { name: 1 }, $limit: 5, $skip: 1 } },
      }),
    );

    expect(sql).toBe(
      `SELECT "Item"."id", (SELECT COALESCE(JSON_AGG("_uql_row" ORDER BY "tags"."_uql_sort_name"), '[]'::json)` +
        ' FROM (SELECT "tags"."name", "tags"."name" "_uql_sort_name" FROM "Tag" "tags" WHERE "tags"."id" IN' +
        ' (SELECT "ItemTag"."tagId" FROM "ItemTag" WHERE "ItemTag"."itemId" = "Item"."id")' +
        ' ORDER BY "_uql_sort_name" LIMIT 5 OFFSET 1) "tags" CROSS JOIN LATERAL (SELECT "tags"."name") "_uql_row") "tags" FROM "Item"',
    );
  }

  /**
   * A hidden sort column would join what `$distinct` deduplicates on, so a relation deduplicating its
   * rows is sorted only by what it selects.
   */
  shouldRejectSortingADistinctRelationByWhatItDoesNotSelect() {
    expect(() =>
      this.exec((ctx) =>
        this.dialect.find(ctx, MeasureUnitCategory, {
          $populate: { measureUnits: { $select: { name: true }, $distinct: true, $sort: { createdAt: 1 } } },
        }),
      ),
    ).toThrow("cannot $sort the $distinct relation 'measureUnits' by 'createdAt', which it does not select");
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

  protected override readonly jsonUpdateCases: Record<JsonUpdateCaseName, { sql: string; values: unknown[] }> = {
    set: {
      sql: 'UPDATE "Company" SET "kind" = COALESCE("kind", \'{}\'::jsonb) || $1::jsonb, "updatedAt" = $2 WHERE "id" = $3',
      values: ['{"private":1}', 123, '1'],
    },
    unsetOnly: {
      sql: 'UPDATE "Company" SET "kind" = ("kind") - $1::text[], "updatedAt" = $2 WHERE "id" = $3',
      values: [['public', 'private'], 123, '1'],
    },
    setUnsetCombined: {
      sql: 'UPDATE "Company" SET "kind" = (COALESCE("kind", \'{}\'::jsonb) || $1::jsonb) - $2::text[], "updatedAt" = $3 WHERE "id" = $4',
      values: ['{"private":1}', ['public'], 123, '1'],
    },
    push: {
      sql: 'UPDATE "Company" SET "kind" = JSONB_SET("kind", \'{tags}\', COALESCE(("kind")->\'tags\', \'[]\'::jsonb) || JSONB_BUILD_ARRAY($1::jsonb)), "updatedAt" = $2 WHERE "id" = $3',
      values: ['"new-tag"', 123, '1'],
    },
    /** `create_if_missing => false` makes a `$pull` on an absent key a no-op. */
    pull: {
      sql: `UPDATE "Company" SET "kind" = JSONB_SET("kind", '{tags}', COALESCE((SELECT JSONB_AGG(_uql_pull.val ORDER BY _uql_pull.ord) FROM JSONB_ARRAY_ELEMENTS("kind"->'tags') WITH ORDINALITY AS _uql_pull(val, ord) WHERE _uql_pull.val <> $1::jsonb), '[]'::jsonb), false), "updatedAt" = $2 WHERE "id" = $3`,
      values: ['"a"', 123, '1'],
    },
    /**
     * Postgres is the one dialect whose `$push` references the accumulated expression twice - safe
     * because `$N` placeholders are numbered, so the reused pull subquery binds its value once.
     */
    pullPushSameKey: {
      sql: `UPDATE "Company" SET "kind" = JSONB_SET(JSONB_SET("kind", '{tags}', COALESCE((SELECT JSONB_AGG(_uql_pull.val ORDER BY _uql_pull.ord) FROM JSONB_ARRAY_ELEMENTS("kind"->'tags') WITH ORDINALITY AS _uql_pull(val, ord) WHERE _uql_pull.val <> $1::jsonb), '[]'::jsonb), false), '{tags}', COALESCE((JSONB_SET("kind", '{tags}', COALESCE((SELECT JSONB_AGG(_uql_pull.val ORDER BY _uql_pull.ord) FROM JSONB_ARRAY_ELEMENTS("kind"->'tags') WITH ORDINALITY AS _uql_pull(val, ord) WHERE _uql_pull.val <> $1::jsonb), '[]'::jsonb), false))->'tags', '[]'::jsonb) || JSONB_BUILD_ARRAY($2::jsonb)), "updatedAt" = $3 WHERE "id" = $4`,
      values: ['"a"', '"b"', 123, '1'],
    },
    setPushCombined: {
      sql: 'UPDATE "Company" SET "kind" = JSONB_SET(COALESCE("kind", \'{}\'::jsonb) || $1::jsonb, \'{tags}\', COALESCE((COALESCE("kind", \'{}\'::jsonb) || $1::jsonb)->\'tags\', \'[]\'::jsonb) || JSONB_BUILD_ARRAY($2::jsonb)), "updatedAt" = $3 WHERE "id" = $4',
      values: ['{"private":1}', '"new-tag"', 123, '1'],
    },
    setPushSameKey: {
      sql: 'UPDATE "Company" SET "kind" = JSONB_SET(COALESCE("kind", \'{}\'::jsonb) || $1::jsonb, \'{tags}\', COALESCE((COALESCE("kind", \'{}\'::jsonb) || $1::jsonb)->\'tags\', \'[]\'::jsonb) || JSONB_BUILD_ARRAY($2::jsonb)), "updatedAt" = $3 WHERE "id" = $4',
      values: ['{"tags":["a"]}', '"b"', 123, '1'],
    },
    pushUnsetCombined: {
      sql: 'UPDATE "Company" SET "kind" = (JSONB_SET("kind", \'{tags}\', COALESCE(("kind")->\'tags\', \'[]\'::jsonb) || JSONB_BUILD_ARRAY($1::jsonb))) - $2::text[], "updatedAt" = $3 WHERE "id" = $4',
      values: ['"new-tag"', ['public'], 123, '1'],
    },
  };

  /** Outside the types, which give a JSON key no `raw()`: evaluated in place, where stringified it was `{}`. */
  shouldSetAJsonKeyToARawExpression() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(ctx, Company, { $where: { id: '1' } }, {
        kind: { $set: { private: raw`1 + ${1}` } },
      } as never),
    );
    expect(sql).toBe(
      'UPDATE "Company" SET "kind" = COALESCE("kind", \'{}\'::jsonb) || $1::jsonb' +
        ' || JSONB_BUILD_OBJECT(\'private\', 1 + $2), "updatedAt" = $3 WHERE "id" = $4',
    );
    expect(values).toEqual(['{}', 1, expect.any(Number), '1']);
  }

  /** A `$set` value that would be falsy in JS (`false`), to confirm it isn't dropped like a missing key. */
  shouldUpdateWithJsonSetBooleanFalse() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        Company,
        { $where: { id: '1' } },
        { kind: { $set: { isArchived: false } }, updatedAt: 1 },
      ),
    );
    expect(sql).toBe(
      'UPDATE "Company" SET "kind" = COALESCE("kind", \'{}\'::jsonb) || $1::jsonb, "updatedAt" = $2 WHERE "id" = $3',
    );
    expect(values).toEqual(['{"isArchived":false}', 1, '1']);
  }

  /**
   * Bun SQL's `explicitJsonCast` wraps every bound JSON parameter in an extra `(::text)::jsonb`
   * cast - a driver-capability difference orthogonal to which operators are combined, so `$push`
   * alone (the simplest case) is enough to pin it without repeating the check per combination.
   */

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

  /**
   * `GREATEST` guards the `-1` Postgres carries for a table nothing has analyzed yet (its "no
   * statistic", verified live on PG 18), which raw would read as a negative row count.
   */

  override shouldFind$nin() {
    const values = ['1', '2'];
    const res = this.exec((ctx) =>
      this.dialect.find(ctx, User, { $select: { id: true }, $where: { id: { $nin: values } } }),
    );
    expect(res.sql).toBe('SELECT "id" FROM "User" WHERE "id" <> ALL($1)');
    expect(res.values).toEqual([values]);
  }

  override shouldUpdateWithJsonbField() {
    const payload: UpdatePayload<Company>['kind'] = { private: 1 };
    const res = this.exec((ctx) =>
      this.dialect.update(ctx, Company, { $where: { id: '1' } }, { kind: payload, updatedAt: 123 }),
    );
    expect(res.sql).toBe('UPDATE "Company" SET "kind" = $1::jsonb, "updatedAt" = $2 WHERE "id" = $3');
    expect(res.values).toEqual(['{"private":1}', 123, '1']);
  }

  /** The configuration binds once and both calls reuse its placeholder, so the document and the query agree. */
  shouldSearchTextUnderAConfiguration() {
    const res = this.exec((ctx) =>
      this.dialect.where(ctx, Item, { $text: { $fields: { name: true }, $value: 'lamp', $config: 'english' } }),
    );
    expect(res.sql).toContain('TO_TSVECTOR($1::regconfig, "name") @@ WEBSEARCH_TO_TSQUERY($1::regconfig, $2)');
    expect(res.values).toEqual(['english', 'lamp']);
  }

  /** With no `$fields`, the search runs over the columns of the fulltext index the entity declares. */
  shouldSearchTheFulltextIndexWhereTextNamesNoFields() {
    @Entity()
    @Index((listing) => [listing.name, listing.description], { type: 'fulltext' })
    class Listing {
      @Id({ type: Number }) id?: number;
      @Field({ type: String }) name?: string;
      @Field({ type: String }) description?: string;
    }
    const res = this.exec((ctx) => this.dialect.where(ctx, Listing, { $text: { $value: 'lamp' } }));
    expect(res.sql).toBe(` WHERE TO_TSVECTOR("name" || ' ' || "description") @@ WEBSEARCH_TO_TSQUERY($1)`);
    expect(res.values).toEqual(['lamp']);
  }

  shouldMatchNothingForAnEmptySet() {
    expect(this.exec((ctx) => this.dialect.where(ctx, Item, { name: { $in: [] } })).sql).toContain('"name" IN (NULL)');
    expect(this.exec((ctx) => this.dialect.where(ctx, Item, { name: { $nin: [] } })).sql).toContain(
      '"name" NOT IN (NULL)',
    );
  }

  /** Outside the types, which give a JSON array no `raw()`: rendered in place rather than bound as an object. */
  shouldPushARawExpressionOntoAJsonArray() {
    const res = this.exec((ctx) =>
      this.dialect.update(ctx, Company, { $where: { id: '1' } }, {
        kind: { $push: { tags: raw`to_jsonb(${'new'}::text)` } },
      } as never),
    );
    expect(res.sql).toContain('JSONB_BUILD_ARRAY(to_jsonb($1::text))');
    expect(res.values).toEqual(['new', expect.any(Number), '1']);
  }
}
