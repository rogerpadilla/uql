import { User, Item, createSpec } from '@uql/core/test';
import { BaseSqlDialectSpec } from '@uql/core/sql/baseSqlDialect-spec';
import { PostgresDialect } from './postgresDialect';

class PostgresDialectSpec extends BaseSqlDialectSpec {
  constructor() {
    super(new PostgresDialect());
  }

  shouldBeValidEscapeCharacter() {
    expect(this.dialect.escapeIdChar).toBe('"');
  }

  shouldBeginTransaction() {
    expect(this.dialect.beginTransactionCommand).toBe('BEGIN');
  }

  shouldFind$startsWith() {
    const sql1 = this.dialect.find(User, {
      project: { id: 1 },
      filter: { name: { $startsWith: 'Some' } },
      sort: { name: 1, id: -1 },
      skip: 0,
      limit: 50,
    });
    expect(sql1).toBe(
      `SELECT "id" FROM "User" WHERE "name" ILIKE 'Some%' ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0`
    );
    const sql2 = this.dialect.find(User, {
      project: { id: 1 },
      filter: { name: { $startsWith: 'Some', $ne: 'Something' } },
      sort: { name: 1, id: -1 },
      skip: 0,
      limit: 50,
    });
    expect(sql2).toBe(
      `SELECT "id" FROM "User" WHERE ("name" ILIKE 'Some%' AND "name" <> 'Something') ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0`
    );
  }

  shouldFind$re() {
    const sql = this.dialect.find(User, {
      project: { id: 1 },
      filter: { name: { $re: '^some' } },
    });
    expect(sql).toBe(`SELECT "id" FROM "User" WHERE "name" ~ '^some'`);
  }

  shouldFind$text() {
    const sql1 = this.dialect.find(Item, {
      project: { id: 1 },
      filter: { $text: { fields: ['name', 'description'], value: 'some text' }, status: 1 },
      limit: 30,
    });
    expect(sql1).toBe(
      `SELECT "id" FROM "Item" WHERE to_tsvector("name" || ' ' || "description") @@ to_tsquery('some text') AND "status" = 1 LIMIT 30`
    );

    const sql2 = this.dialect.find(User, {
      project: { id: 1 },
      filter: {
        $text: { fields: ['name'], value: 'something' },
        name: { $ne: 'other unwanted' },
        status: 1,
      },
      limit: 10,
    });
    expect(sql2).toBe(
      `SELECT "id" FROM "User" WHERE to_tsvector("name") @@ to_tsquery('something') AND "name" <> 'other unwanted' AND "status" = 1 LIMIT 10`
    );
  }
}

createSpec(new PostgresDialectSpec());
