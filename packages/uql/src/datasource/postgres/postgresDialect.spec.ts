import { User, Item, ItemAdjustment, TaxCategory } from 'uql/mock';
import { createSpec, Spec } from 'uql/util';
import { Query, QueryProject, QuerySort } from 'uql/type';
import { PostgresDialect } from './postgresDialect';

class PostgresDialectSpec implements Spec {
  readonly sql = new PostgresDialect();

  shouldBeginTransaction() {
    expect(this.sql.beginTransactionCommand).toBe('BEGIN');
  }

  shouldCreate() {
    const bodies: User[] = [
      {
        name: 'Some Name 1',
        email: 'someemail1@example.com',
        createdAt: 123,
      },
      {
        name: 'Some Name 2',
        email: 'someemail2@example.com',
        createdAt: 456,
      },
      {
        name: 'Some Name 3',
        email: 'someemail3@example.com',
        createdAt: 789,
      },
    ];
    const query = this.sql.insert(User, bodies);
    expect(query).toBe(
      'INSERT INTO "User" ("name", "email", "createdAt") VALUES' +
        " ('Some Name 1', 'someemail1@example.com', 123)" +
        ", ('Some Name 2', 'someemail2@example.com', 456)" +
        ", ('Some Name 3', 'someemail3@example.com', 789) RETURNING id insertId"
    );
  }

  shouldCreateOne() {
    const body: User = {
      name: 'Some Name',
      email: 'someemail@example.com',
      createdAt: 123,
    };
    const query = this.sql.insert(User, body);
    expect(query).toBe(
      `INSERT INTO "User" ("name", "email", "createdAt") VALUES ('Some Name', 'someemail@example.com', 123) RETURNING id insertId`
    );
  }

  shouldCreateOneOnInsert() {
    const body: TaxCategory = {
      name: 'Some Name',
      createdAt: 123,
    };
    const query = this.sql.insert(TaxCategory, body);
    expect(query).toMatch(
      /^INSERT INTO "TaxCategory" \("name", "createdAt", "pk"\) VALUES \('Some Name', 123, '[a-f0-9\\-]+'\) RETURNING pk insertId$/
    );
  }

  shouldUpdate() {
    const query = this.sql.update(
      User,
      { name: 'some', user: '123' },
      {
        name: 'Some Text',
        updatedAt: 321,
      }
    );
    expect(query).toBe(
      `UPDATE "User" SET "name" = 'Some Text', "updatedAt" = 321 WHERE "name" = 'some' AND "user" = '123'`
    );
  }

  shouldFind() {
    const query = this.sql.find(User, {
      filter: { id: '123', name: 'abc' },
    });
    expect(query).toBe(`SELECT * FROM "User" WHERE "id" = '123' AND "name" = 'abc'`);
  }

  shouldFind$and() {
    const quer1 = this.sql.find(User, {
      filter: { $and: { id: '123', name: 'abc' } },
    });
    expect(quer1).toBe(`SELECT * FROM "User" WHERE "id" = '123' AND "name" = 'abc'`);
    const query2 = this.sql.find(User, {
      filter: { $and: { id: '123', name: 'abc' } },
    });
    expect(query2).toBe(`SELECT * FROM "User" WHERE "id" = '123' AND "name" = 'abc'`);
    const query3 = this.sql.find(User, {
      filter: { $and: { id: '123' }, name: 'abc' },
    });
    expect(query3).toBe(`SELECT * FROM "User" WHERE "id" = '123' AND "name" = 'abc'`);
  }

  shouldFind$or() {
    const query1 = this.sql.find(User, {
      filter: { $or: { id: '123' } },
    });
    expect(query1).toBe(`SELECT * FROM "User" WHERE "id" = '123'`);
    const query2 = this.sql.find(User, {
      filter: { $or: { id: '123', name: 'abc' } },
    });
    expect(query2).toBe(`SELECT * FROM "User" WHERE "id" = '123' OR "name" = 'abc'`);
    const query3 = this.sql.find(User, {
      filter: { $or: { id: '123' }, name: 'abc' },
    });
    expect(query3).toBe(`SELECT * FROM "User" WHERE "id" = '123' AND "name" = 'abc'`);
  }

  shouldFindLogicalOperators() {
    const query1 = this.sql.find(User, {
      filter: { user: '1', $or: { name: { $in: ['a', 'b', 'c'] }, email: 'abc@example.com' }, id: '1' },
    });
    expect(query1).toBe(
      `SELECT * FROM "User" WHERE "user" = '1' AND ("name" IN ('a', 'b', 'c') OR "email" = 'abc@example.com') AND "id" = '1'`
    );
    const query2 = this.sql.find(User, {
      filter: {
        user: '1',
        $or: { name: { $in: ['a', 'b', 'c'] }, email: 'abc@example.com' },
        id: '1',
        email: 'e',
      },
    });
    expect(query2).toBe(
      `SELECT * FROM "User" WHERE "user" = '1'` +
        ` AND ("name" IN ('a', 'b', 'c') OR "email" = 'abc@example.com') AND "id" = '1' AND "email" = 'e'`
    );
    const query3 = this.sql.find(User, {
      filter: {
        user: '1',
        $or: { name: { $in: ['a', 'b', 'c'] }, email: 'abc@example.com' },
        id: '1',
        email: 'e',
      },
      sort: { name: 1, createdAt: -1 },
      skip: 50,
      limit: 10,
    });
    expect(query3).toBe(
      `SELECT * FROM "User" WHERE "user" = '1'` +
        ` AND ("name" IN ('a', 'b', 'c') OR "email" = 'abc@example.com')` +
        ` AND "id" = '1' AND "email" = 'e'` +
        ' ORDER BY "name", "createdAt" DESC LIMIT 10 OFFSET 50'
    );
  }

  shouldFindSingleFilter() {
    const query = this.sql.find(User, {
      filter: { name: 'some' },
      limit: 3,
    });
    expect(query).toBe(`SELECT * FROM "User" WHERE "name" = 'some' LIMIT 3`);
  }

  shouldFindUnknownComparisonOperator() {
    expect(() =>
      this.sql.find(User, {
        filter: { name: { $someInvalidOperator: 'some' } as unknown },
      })
    ).toThrowError('unknown operator: $someInvalidOperator');
  }

  shouldFindMultipleComparisonOperators() {
    const query1 = this.sql.find(User, {
      filter: { $or: { name: { $eq: 'other', $ne: 'other unwanted' }, status: 1 } },
      limit: 10,
    });
    expect(query1).toBe(
      `SELECT * FROM "User" WHERE ("name" = 'other' AND "name" <> 'other unwanted') OR "status" = 1 LIMIT 10`
    );

    const query2 = this.sql.find(User, {
      filter: { createdAt: { $gte: 123, $lte: 999 } },
      limit: 10,
    });
    expect(query2).toBe('SELECT * FROM "User" WHERE ("createdAt" >= 123 AND "createdAt" <= 999) LIMIT 10');

    const query3 = this.sql.find(User, {
      filter: { createdAt: { $gt: 123, $lt: 999 } },
      limit: 10,
    });
    expect(query3).toBe('SELECT * FROM "User" WHERE ("createdAt" > 123 AND "createdAt" < 999) LIMIT 10');
  }

  shouldFind$ne() {
    const query = this.sql.find(User, {
      filter: { name: 'some', status: { $ne: 5 } },
      limit: 20,
    });
    expect(query).toBe(`SELECT * FROM "User" WHERE "name" = 'some' AND "status" <> 5 LIMIT 20`);
  }

  shouldFindIsNotNull() {
    const query1 = this.sql.find(User, {
      filter: { user: '123', status: null },
      limit: 5,
    });
    expect(query1).toBe(`SELECT * FROM "User" WHERE "user" = '123' AND "status" IS NULL LIMIT 5`);
    const query2 = this.sql.find(User, {
      filter: { user: '123', status: { $ne: null } },
      limit: 5,
    });
    expect(query2).toBe(`SELECT * FROM "User" WHERE "user" = '123' AND "status" IS NOT NULL LIMIT 5`);
  }

  shouldFind$in() {
    const query = this.sql.find(User, {
      filter: { name: 'some', status: { $in: [1, 2, 3] } },
      limit: 10,
    });
    expect(query).toBe(`SELECT * FROM "User" WHERE "name" = 'some' AND "status" IN (1, 2, 3) LIMIT 10`);
  }

  shouldFind$nin() {
    const query = this.sql.find(User, {
      filter: { name: 'some', status: { $nin: [1, 2, 3] } },
      limit: 10,
    });
    expect(query).toBe(`SELECT * FROM "User" WHERE "name" = 'some' AND "status" NOT IN (1, 2, 3) LIMIT 10`);
  }

  shouldFindPopulateWithProjectedFields() {
    const query1 = this.sql.find(Item, {
      project: { id: 1, name: 1, code: 1 },
      populate: {
        tax: { project: { id: 1, name: 1 } },
        measureUnit: { project: { id: 1, name: 1, category: 1 } },
      },
      limit: 100,
    });
    expect(query1).toBe(
      'SELECT "Item"."id", "Item"."name", "Item"."code"' +
        ', "tax"."id" "tax.id", "tax"."name" "tax.name"' +
        ', "measureUnit"."id" "measureUnit.id", "measureUnit"."name" "measureUnit.name", "measureUnit"."category" "measureUnit.category"' +
        ' FROM "Item"' +
        ' LEFT JOIN "Tax" "tax" ON "tax"."id" = "Item"."tax"' +
        ' LEFT JOIN "MeasureUnit" "measureUnit" ON "measureUnit"."id" = "Item"."measureUnit"' +
        ' LIMIT 100'
    );

    const query2 = this.sql.find(User, { populate: { company: {} } });
    expect(query2).toBe(
      'SELECT "User".*, "company"."id" "company.id", "company"."company" "company.company", "company"."user" "company.user", "company"."createdAt" "company.createdAt", "company"."updatedAt" "company.updatedAt", "company"."status" "company.status", "company"."name" "company.name", "company"."description" "company.description" FROM "User" LEFT JOIN "Company" "company" ON "company"."id" = "User"."company"'
    );
  }

  shouldFindPopulateWithAllFieldsAndSpecificFieldsAndFilterByPopulated() {
    const qm: Query<Item> = {
      project: { id: 1, name: 1 },
      populate: { tax: {}, measureUnit: { project: { id: 1, name: 1 } } },
      filter: { 'measureUnit.name': { $ne: 'unidad' }, 'tax.id': 2 } as Item,
      sort: { 'category.name': 1, 'MeasureUnit.name': 1 } as QuerySort<Item>,
      limit: 100,
    };
    const query = this.sql.find(Item, qm);
    expect(query).toBe(
      'SELECT "Item"."id", "Item"."name"' +
        ', "tax"."id" "tax.id", "tax"."company" "tax.company", "tax"."user" "tax.user", "tax"."createdAt" "tax.createdAt"' +
        ', "tax"."updatedAt" "tax.updatedAt", "tax"."status" "tax.status", "tax"."name" "tax.name", "tax"."percentage" "tax.percentage"' +
        ', "tax"."category" "tax.category", "tax"."description" "tax.description"' +
        ', "measureUnit"."id" "measureUnit.id", "measureUnit"."name" "measureUnit.name"' +
        ' FROM "Item"' +
        ' LEFT JOIN "Tax" "tax" ON "tax"."id" = "Item"."tax"' +
        ' LEFT JOIN "MeasureUnit" "measureUnit" ON "measureUnit"."id" = "Item"."measureUnit"' +
        ` WHERE "measureUnit"."name" <> 'unidad' AND "tax"."id" = 2` +
        ' ORDER BY "category"."name", "MeasureUnit"."name" LIMIT 100'
    );
  }

  shouldFindDeepPopulateWithProjectedFields() {
    const query1 = this.sql.find(Item, {
      project: { id: 1, name: 1, code: 1 },
      populate: {
        measureUnit: {
          project: { id: 1, name: 1, category: 1 },
          populate: { category: { project: { name: 1 } } },
        },
      },
      limit: 100,
    });
    expect(query1).toBe(
      'SELECT "Item"."id", "Item"."name", "Item"."code"' +
        ', "measureUnit"."id" "measureUnit.id", "measureUnit"."name" "measureUnit.name", "measureUnit"."category" "measureUnit.category"' +
        ', "measureUnit.category"."name" "measureUnit.category.name"' +
        ' FROM "Item"' +
        ' LEFT JOIN "MeasureUnit" "measureUnit" ON "measureUnit"."id" = "Item"."measureUnit"' +
        ' LEFT JOIN "MeasureUnitCategory" "measureUnit.category" ON "measureUnit.category"."id" = "measureUnit"."category"' +
        ' LIMIT 100'
    );
    const query2 = this.sql.find(Item, {
      project: { id: 1, name: 1, code: 1 },
      populate: {
        measureUnit: {
          project: { id: 1, name: 1 },
          populate: { category: { project: { id: 1, name: 1 } } },
        },
      },
      limit: 100,
    });
    expect(query2).toBe(
      'SELECT "Item"."id", "Item"."name", "Item"."code"' +
        ', "measureUnit"."id" "measureUnit.id", "measureUnit"."name" "measureUnit.name"' +
        ', "measureUnit.category"."id" "measureUnit.category.id", "measureUnit.category"."name" "measureUnit.category.name"' +
        ' FROM "Item"' +
        ' LEFT JOIN "MeasureUnit" "measureUnit" ON "measureUnit"."id" = "Item"."measureUnit"' +
        ' LEFT JOIN "MeasureUnitCategory" "measureUnit.category" ON "measureUnit.category"."id" = "measureUnit"."category"' +
        ' LIMIT 100'
    );
    const query3 = this.sql.find(ItemAdjustment, {
      project: { id: 1, buyPrice: 1, number: 1 },
      populate: {
        item: {
          project: { id: 1, name: 1 },
          populate: {
            measureUnit: {
              project: { id: 1, name: 1 },
              populate: { category: { project: { id: 1, name: 1 } } },
            },
          },
        },
      },
      limit: 100,
    });
    expect(query3).toBe(
      'SELECT "ItemAdjustment"."id", "ItemAdjustment"."buyPrice", "ItemAdjustment"."number"' +
        ', "item"."id" "item.id", "item"."name" "item.name"' +
        ', "item.measureUnit"."id" "item.measureUnit.id", "item.measureUnit"."name" "item.measureUnit.name"' +
        ', "item.measureUnit.category"."id" "item.measureUnit.category.id", "item.measureUnit.category"."name" "item.measureUnit.category.name"' +
        ' FROM "ItemAdjustment"' +
        ' LEFT JOIN "Item" "item" ON "item"."id" = "ItemAdjustment"."item"' +
        ' LEFT JOIN "MeasureUnit" "item.measureUnit" ON "item.measureUnit"."id" = "item"."measureUnit"' +
        ' LEFT JOIN "MeasureUnitCategory" "item.measureUnit.category" ON "item.measureUnit.category"."id" = "item.measureUnit"."category"' +
        ' LIMIT 100'
    );
  }

  shouldFindPopulatePropertiesWithNotFixedType() {
    const query = this.sql.find(Item, {
      project: { id: 1, name: 1 },
      populate: { user: { project: { id: 1, name: 1 } }, company: { project: { id: 1, name: 1 } } },
    });
    expect(query).toBe(
      'SELECT "Item"."id", "Item"."name"' +
        ', "user"."id" "user.id", "user"."name" "user.name"' +
        ', "company"."id" "company.id", "company"."name" "company.name"' +
        ' FROM "Item"' +
        ' LEFT JOIN "User" "user" ON "user"."id" = "Item"."user"' +
        ' LEFT JOIN "Company" "company" ON "company"."id" = "Item"."company"'
    );
  }

  shouldFindGroup() {
    const query1 = this.sql.find(User, {
      group: ['company'],
    });
    expect(query1).toBe('SELECT * FROM "User" GROUP BY "company"');
    const query2 = this.sql.find(User, {
      project: { id: 1, name: 1 },
      filter: { status: 1 },
      group: ['company', 'profile'],
      skip: 50,
      limit: 100,
      sort: { name: 1 },
    });
    expect(query2).toBe(
      'SELECT "id", "name" FROM "User" WHERE "status" = 1 GROUP BY "company", "profile" ORDER BY "name" LIMIT 100 OFFSET 50'
    );
  }

  shouldFindLimit() {
    const query1 = this.sql.find(User, {
      filter: { id: '9' },
      limit: 1,
    });
    expect(query1).toBe(`SELECT * FROM "User" WHERE "id" = '9' LIMIT 1`);
    const query2 = this.sql.find(User, {
      filter: { id: '9' },
      project: { id: 1, name: 1, user: 1 },
      limit: 1,
    });
    expect(query2).toBe(`SELECT "id", "name", "user" FROM "User" WHERE "id" = '9' LIMIT 1`);
    const query3 = this.sql.find(User, {
      filter: { name: 'something', user: '123' },
      limit: 1,
    });
    expect(query3).toBe(`SELECT * FROM "User" WHERE "name" = 'something' AND "user" = '123' LIMIT 1`);
    const query4 = this.sql.find(User, {
      project: { id: 1, name: 1, user: 1 },
      filter: { user: '123' },
      limit: 25,
    });
    expect(query4).toBe(`SELECT "id", "name", "user" FROM "User" WHERE "user" = '123' LIMIT 25`);
  }

  shouldFindProject() {
    expect(
      this.sql.find(User, {
        project: { password: false },
      })
    ).toBe(
      'SELECT "id", "company", "user", "createdAt", "updatedAt", "status", "name", "email", "profile" FROM "User"'
    );

    expect(
      this.sql.find(User, {
        project: { name: 0, password: 0 },
      })
    ).toBe('SELECT "id", "company", "user", "createdAt", "updatedAt", "status", "email", "profile" FROM "User"');

    expect(
      this.sql.find(User, {
        project: { id: 1, name: 1, password: 0 },
      })
    ).toBe('SELECT "id", "name" FROM "User"');

    expect(
      this.sql.find(User, {
        project: { id: 1, name: 0, password: 0 },
      })
    ).toBe('SELECT "id" FROM "User"');

    expect(
      this.sql.find(
        User,
        {
          project: {
            '*': 1,
            'LOG10(numberOfVotes + 1) * 287014.5873982681 + createdAt AS hotness': 1,
          } as QueryProject<User>,
          filter: { name: 'something' },
        },
        { isTrustedProject: true }
      )
    ).toBe(
      'SELECT *, LOG10(numberOfVotes + 1) * 287014.5873982681 + createdAt AS hotness' +
        ` FROM "User" WHERE "name" = 'something'`
    );
  }

  shouldRemove() {
    const query1 = this.sql.remove(User, { id: '123' });
    expect(query1).toBe(`DELETE FROM "User" WHERE "id" = '123'`);
    const query2 = this.sql.remove(User, { company: '123' });
    expect(query2).toBe(`DELETE FROM "User" WHERE "company" = '123'`);
  }

  shouldFind$startsWith() {
    const query1 = this.sql.find(User, {
      filter: { name: { $startsWith: 'Some' } },
      sort: { name: 1, id: -1 },
      skip: 0,
      limit: 50,
    });
    expect(query1).toBe(`SELECT * FROM "User" WHERE "name" ILIKE 'Some%' ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0`);
    const query2 = this.sql.find(User, {
      filter: { name: { $startsWith: 'Some', $ne: 'Something' } },
      sort: { name: 1, id: -1 },
      skip: 0,
      limit: 50,
    });
    expect(query2).toBe(
      `SELECT * FROM "User" WHERE ("name" ILIKE 'Some%' AND "name" <> 'Something') ORDER BY "name", "id" DESC LIMIT 50 OFFSET 0`
    );
  }

  shouldFind$re() {
    const query = this.sql.find(User, {
      filter: { name: { $re: '^some' } },
    });
    expect(query).toBe(`SELECT * FROM "User" WHERE "name" ~ '^some'`);
  }

  shouldFind$text() {
    const query1 = this.sql.find(Item, {
      filter: { $text: { fields: ['name', 'description'], value: 'some text' }, status: 1 },
      limit: 30,
    });
    expect(query1).toBe(
      `SELECT * FROM "Item" WHERE to_tsvector("name" || ' ' || "description") @@ to_tsquery('some text') AND "status" = 1 LIMIT 30`
    );

    const query2 = this.sql.find(User, {
      filter: {
        $text: { fields: ['name'], value: 'something' },
        name: { $ne: 'other unwanted' },
        status: 1,
      },
      limit: 10,
    });
    expect(query2).toBe(
      `SELECT * FROM "User" WHERE to_tsvector("name") @@ to_tsquery('something') AND "name" <> 'other unwanted' AND "status" = 1 LIMIT 10`
    );
  }
}

createSpec(new PostgresDialectSpec());
