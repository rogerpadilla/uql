import { Item, User } from 'nukak/test';
import { PostgresDialect } from './postgresDialect.js';

const dialect = new PostgresDialect();

describe('mongoToSQL', () => {
  it('converts simple find query', () => {
    const sql = dialect.aggregate(User, [{ $match: { age: { $gt: 18 } } }]);

    expect(sql).toBe(
      'SELECT "id", "companyId", "creatorId", "createdAt", "updatedAt", "name", "email", "password" FROM "User" WHERE "age" > 18',
    );
  });

  it('converts query with projection', () => {
    const sql = dialect.aggregate(User, [
      {
        $project: {
          name: 1,
          email: 1,
        },
      },
    ]);

    expect(sql).toBe('SELECT "name", "email" FROM "User"');
  });

  it('converts query with grouping', () => {
    const sql = dialect.aggregate(Item, [
      {
        $group: {
          _id: 'taxId',
          total: { $sum: 'salePrice' },
        },
      },
    ]);

    expect(sql).toBe(
      'SELECT "id", "companyId", "creatorId", "createdAt", "updatedAt", "name", "description", "code", "buyLedgerAccountId", "saleLedgerAccountId", "taxId", "measureUnitId", "salePrice", "inventoryable", (SELECT COUNT(*) "count" FROM "ItemTag" WHERE "ItemTag"."itemId" = "id") "tagsCount" FROM "Item" GROUP BY "taxId" total(SUM("salePrice")) AS "total"',
    );
  });

  it('converts query with multiple stages', () => {
    const sql = dialect.aggregate(Item, [{ $match: { code: 'A' } }, { $sort: { createdAt: -1 } }, { $limit: 10 }]);

    expect(sql).toBe(
      `SELECT "id", "companyId", "creatorId", "createdAt", "updatedAt", "name", "description", "code", "buyLedgerAccountId", "saleLedgerAccountId", "taxId", "measureUnitId", "salePrice", "inventoryable", (SELECT COUNT(*) "count" FROM "ItemTag" WHERE "ItemTag"."itemId" = "id") "tagsCount" FROM "Item" WHERE "code" = 'A' ORDER BY "createdAt" DESC LIMIT 10`,
    );
  });

  it('converts query with lookup stage', () => {
    const sql = dialect.aggregate(Item, [
      {
        $lookup: {
          from: 'Tax',
          localField: 'taxId',
          foreignField: '_id',
          as: 'tax',
        },
      },
    ]);

    expect(sql).toBe(
      'SELECT "id", "companyId", "creatorId", "createdAt", "updatedAt", "name", "description", "code", "buyLedgerAccountId", "saleLedgerAccountId", "taxId", "measureUnitId", "salePrice", "inventoryable", (SELECT COUNT(*) "count" FROM "ItemTag" WHERE "ItemTag"."itemId" = "id") "tagsCount" FROM "Item" LEFT JOIN "Tax" ON "taxId" = "_id" AS "tax"',
    );
  });

  it('converts query with unwind stage', () => {
    const sql = dialect.aggregate(Item, [{ $unwind: 'tags' }]);

    expect(sql).toBe(
      'SELECT "id", "companyId", "creatorId", "createdAt", "updatedAt", "name", "description", "code", "buyLedgerAccountId", "saleLedgerAccountId", "taxId", "measureUnitId", "salePrice", "inventoryable", (SELECT COUNT(*) "count" FROM "ItemTag" WHERE "ItemTag"."itemId" = "id") "tagsCount" FROM "Item" UNWIND "tags" AS UNP IVOT',
    );
  });

  it('converts full aggregation pipeline', () => {
    const sql = dialect.aggregate(Item, [
      { $match: { status: 'A' } },
      {
        $lookup: {
          from: 'Company',
          localField: 'companyId',
          foreignField: '_id',
          as: 'company',
        },
      },
      { $unwind: 'lineItems' },
      {
        $group: {
          _id: 'company.category',
          totalSales: { $sum: 'lineItems.price' },
        },
      },
      { $sort: { totalSales: -1 } },
    ]);

    // expect(sql).toMatchSnapshot();
    // Snapshot the full SQL string
  });

  it('handles $match with operators', () => {
    const sql = dialect.aggregate(Item, [
      {
        $match: {
          createdAt: { $gte: '2020-01-01' },
          'lineItems.quantity': { $lt: 5 },
        },
      },
    ]);

    expect(sql).toBe(
      `SELECT "id", "companyId", "creatorId", "createdAt", "updatedAt", "name", "description", "code", "buyLedgerAccountId", "saleLedgerAccountId", "taxId", "measureUnitId", "salePrice", "inventoryable", (SELECT COUNT(*) "count" FROM "ItemTag" WHERE "ItemTag"."itemId" = "id") "tagsCount" FROM "Item" WHERE "createdAt" >= '2020-01-01' AND "lineItems"."quantity" < 5`,
    );
  });

  it('handles dotted field names', () => {
    const sql = dialect.aggregate(User, [{ $match: { 'address.city': 'New York' } }]);

    expect(sql).toBe(
      `SELECT "id", "companyId", "creatorId", "createdAt", "updatedAt", "name", "email", "password" FROM "User" WHERE "address"."city" = 'New York'`,
    );
  });

  it('returns empty string for no stages', () => {
    const sql = dialect.aggregate(Item);

    expect(sql).toBe(
      'SELECT "id", "companyId", "creatorId", "createdAt", "updatedAt", "name", "description", "code", "buyLedgerAccountId", "saleLedgerAccountId", "taxId", "measureUnitId", "salePrice", "inventoryable", (SELECT COUNT(*) "count" FROM "ItemTag" WHERE "ItemTag"."itemId" = "id") "tagsCount" FROM "Item"',
    );
  });

  it('escapes identifiers with quotes', () => {
    const sql = dialect.aggregate(Item, [{ $match: { code: 'A' } }]);

    expect(sql).toBe(
      `SELECT "id", "companyId", "creatorId", "createdAt", "updatedAt", "name", "description", "code", "buyLedgerAccountId", "saleLedgerAccountId", "taxId", "measureUnitId", "salePrice", "inventoryable", (SELECT COUNT(*) "count" FROM "ItemTag" WHERE "ItemTag"."itemId" = "id") "tagsCount" FROM "Item" WHERE "code" = 'A'`,
    );
  });

  it('converts $lookup stage', () => {
    const sql = dialect.aggregate(Item, [
      {
        $lookup: {
          from: 'Tax',
          localField: 'taxId',
          foreignField: '_id',
          as: 'tax',
        },
      },
    ]);

    expect(sql).toBe(
      'SELECT "id", "companyId", "creatorId", "createdAt", "updatedAt", "name", "description", "code", "buyLedgerAccountId", "saleLedgerAccountId", "taxId", "measureUnitId", "salePrice", "inventoryable", (SELECT COUNT(*) "count" FROM "ItemTag" WHERE "ItemTag"."itemId" = "id") "tagsCount" FROM "Item" LEFT JOIN "Tax" ON "taxId" = "_id" AS "tax"',
    );
  });

  it('handles nested objects in $match', () => {
    const sql = dialect.aggregate(Item, [
      {
        $match: {
          'customer.address.city': 'New York',
        },
      },
    ]);

    expect(sql).toBe(
      `SELECT "id", "companyId", "creatorId", "createdAt", "updatedAt", "name", "description", "code", "buyLedgerAccountId", "saleLedgerAccountId", "taxId", "measureUnitId", "salePrice", "inventoryable", (SELECT COUNT(*) "count" FROM "ItemTag" WHERE "ItemTag"."itemId" = "id") "tagsCount" FROM "Item" WHERE "customer"."address"."city" = 'New York'`,
    );
  });

  it('converts $unwind stage', () => {
    const sql = dialect.aggregate(Item, [{ $unwind: 'lineItems' }]);

    expect(sql).toBe(
      'SELECT "id", "companyId", "creatorId", "createdAt", "updatedAt", "name", "description", "code", "buyLedgerAccountId", "saleLedgerAccountId", "taxId", "measureUnitId", "salePrice", "inventoryable", (SELECT COUNT(*) "count" FROM "ItemTag" WHERE "ItemTag"."itemId" = "id") "tagsCount" FROM "Item" UNWIND "lineItems" AS UNP IVOT',
    );
  });

  it('conver $unwind state advanced', () => {
    const sql = dialect.aggregate(Item, [
      // First Stage
      { $project: { code: 1, tags: 1, salePrice: 1 } },
      // Second Stage
      { $unwind: 'tags' },
      // Third Stage
      { $group: { _id: 'tags', averageGenreRating: { $avg: 'salePrice' } } },
      // Fourth Stage
      { $sort: { averageGenreRating: -1 } },
    ]);

    expect(sql).toBe(
      'SELECT "tags" AS _id, AVG(salePrice) AS averageGenreRating FROM (SELECT code, tags, salePrice FROM Item) AS m UNNEST(tags) AS tags GROUP BY tags ORDER BY averageGenreRating DESC',
    );
  });
});
