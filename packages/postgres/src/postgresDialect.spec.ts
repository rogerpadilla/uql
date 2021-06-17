import { User, Item, createSpec, TaxCategory } from '@uql/core/test';
import { BaseSqlDialectSpec } from '@uql/core/sql/baseSqlDialect-spec';
import { PostgresDialect } from './postgresDialect';

class PostgresDialectSpec {
  readonly dialect = new PostgresDialect();

  shouldBeValidEscapeCharacter() {
    expect(this.dialect.escapeIdChar).toBe('"');
  }

  shouldBeginTransaction() {
    expect(this.dialect.beginTransactionCommand).toBe('BEGIN');
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
      ])
    ).toBe(
      'INSERT INTO "User" ("name", "email", "createdAt") VALUES' +
        " ('Some name 1', 'someemail1@example.com', 123)" +
        ", ('Some name 2', 'someemail2@example.com', 456)" +
        ", ('Some name 3', 'someemail3@example.com', 789)" +
        ' RETURNING "id" "id"'
    );
  }

  shouldInsertOne() {
    expect(
      this.dialect.insert(User, {
        name: 'Some Name',
        email: 'someemail@example.com',
        createdAt: 123,
      })
    ).toBe(
      `INSERT INTO "User" ("name", "email", "createdAt") VALUES ('Some Name', 'someemail@example.com', 123) RETURNING "id" "id"`
    );
  }

  shouldInsertWithOnInsertId() {
    expect(
      this.dialect.insert(TaxCategory, {
        name: 'Some Name',
        createdAt: 123,
      })
    ).toMatch(
      /^INSERT INTO "TaxCategory" \("name", "createdAt", "pk"\) VALUES \('Some Name', 123, '.+'\) RETURNING "pk" "id"$/
    );
  }

  shouldFind$startsWith() {
    expect(
      this.dialect.find(User, {
        $project: { id: 1 },
        $filter: { name: { $startsWith: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      })
    ).toBe(`SELECT "id" FROM "User" WHERE "name" ILIKE 'Some%' ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0`);

    expect(
      this.dialect.find(User, {
        $project: { id: 1 },
        $filter: { name: { $startsWith: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      })
    ).toBe(
      `SELECT "id" FROM "User" WHERE ("name" ILIKE 'Some%' AND "name" <> 'Something') ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0`
    );
  }

  shouldFind$regex() {
    expect(
      this.dialect.find(User, {
        $project: { id: 1 },
        $filter: { name: { $regex: '^some' } },
      })
    ).toBe(`SELECT "id" FROM "User" WHERE "name" ~ '^some'`);
  }

  shouldFind$text() {
    expect(
      this.dialect.find(Item, {
        $project: { id: 1 },
        $filter: { $text: { $fields: ['name', 'description'], $value: 'some text' }, code: '1' },
        $limit: 30,
      })
    ).toBe(
      `SELECT "id" FROM "Item" WHERE to_tsvector("name" || ' ' || "description") @@ to_tsquery('some text') AND "code" = '1' LIMIT 30`
    );

    expect(
      this.dialect.find(User, {
        $project: { id: 1 },
        $filter: {
          $text: { $fields: ['name'], $value: 'something' },
          name: { $ne: 'other unwanted' },
          creatorId: 1,
        },
        $limit: 10,
      })
    ).toBe(
      `SELECT "id" FROM "User" WHERE to_tsvector("name") @@ to_tsquery('something') AND "name" <> 'other unwanted' AND "creatorId" = 1 LIMIT 10`
    );
  }
}

createSpec(new PostgresDialectSpec());
