import { expect } from 'vitest';
import { AbstractSqlDialectSpec, type JsonUpdateCaseName } from '../dialect/abstractSqlDialect-spec.js';
import { Entity, Field, Id } from '../entity/index.js';
import {
  Company,
  createSpec,
  InventoryAdjustment,
  Item,
  ItemTag,
  MeasureUnitCategory,
  Profile,
  TaxCategory,
  User,
} from '../test/index.js';

import { SqliteDialect } from './sqliteDialect.js';

class SqliteDialectSpec extends AbstractSqlDialectSpec {
  constructor() {
    super(new SqliteDialect({}));
  }

  override shouldBeginTransaction() {
    expect(this.dialect.beginTransactionCommand).toBe('BEGIN TRANSACTION');
  }

  shouldGetBeginTransactionStatementsWithIsolationLevel() {
    // SQLite uses 'none' strategy - isolation level is silently ignored
    expect(this.dialect.getBeginTransactionStatements('serializable')).toEqual(['BEGIN TRANSACTION']);
    expect(this.dialect.getBeginTransactionStatements('read committed')).toEqual(['BEGIN TRANSACTION']);
  }

  override shouldUpsert() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        TaxCategory,
        { pk: true },
        {
          pk: 'a',
          name: 'Some Name D',
          createdAt: 1,
          updatedAt: 1,
        },
      ),
    );
    expect(sql).toMatch(
      /^INSERT INTO `TaxCategory` \(.*`pk`.*`name`.*`createdAt`.*`updatedAt`.*\) VALUES \(\?, \?, \?, \?\) ON CONFLICT \(`pk`\) DO UPDATE SET .*`name` = EXCLUDED.`name`.*`createdAt` = EXCLUDED.`createdAt`.*`updatedAt` = EXCLUDED.`updatedAt`.* RETURNING `pk` `id`$/,
    );
    expect(values).toEqual(['a', 'Some Name D', 1, 1]);
  }

  override shouldUpsertMany() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(ctx, User, { email: true }, [
        {
          name: 'Name A',
          email: 'a@example.com',
          createdAt: 100,
        },
        {
          name: 'Name B',
          email: 'b@example.com',
          createdAt: 200,
        },
      ]),
    );
    expect(sql).toMatch(
      /^INSERT INTO `User` .*VALUES \(\?, \?, \?\), \(\?, \?, \?\) ON CONFLICT \(`email`\) DO UPDATE SET.* RETURNING `id` `id`$/,
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
      /^INSERT INTO `user_profile` \(.*`pk`.*`image`.*`createdAt`.*\) VALUES \(\?, \?, \?\) ON CONFLICT \(`pk`\) DO UPDATE SET .*`image` = EXCLUDED.`image`.*`updatedAt` = \?.*$/,
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
      /^INSERT INTO `User` \(.*`id`.*`email`.*`createdAt`.*\) VALUES \(\?, \?, \?\) ON CONFLICT \(`id`\) DO UPDATE SET .*`updatedAt` = \?.*$/,
    );
    expect(values).toEqual([1, 'a@b.com', expect.any(Number), expect.any(Number)]);
  }

  override shouldInsertOne() {
    let res = this.exec((ctx) =>
      this.dialect.insert(ctx, User, {
        name: 'Some Name',
        email: 'someemail@example.com',
        createdAt: 123,
      }),
    );
    expect(res.sql).toBe('INSERT INTO `User` (`name`, `email`, `createdAt`) VALUES (?, ?, ?) RETURNING `id` `id`');
    expect(res.values).toEqual(['Some Name', 'someemail@example.com', 123]);

    res = this.exec((ctx) =>
      this.dialect.insert(ctx, InventoryAdjustment, {
        date: new Date(Date.UTC(2021, 11, 31, 23, 59, 59, 999)),
        createdAt: 123,
      }),
    );
    expect(res.sql).toBe('INSERT INTO `InventoryAdjustment` (`date`, `createdAt`) VALUES (?, ?) RETURNING `id` `id`');
    expect(res.values[0]).toBe(1640995199999);
    expect(res.values[1]).toBe(123);
  }

  /**
   * SQLite has no `DEFAULT` keyword inside `VALUES`, so omitted columns insert `NULL` (which is
   * also how it auto-generates an INTEGER PRIMARY KEY for the record without an id).
   */
  override shouldInsertManyWithHeterogeneousColumns() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.insert(ctx, User, [
        { id: 5, name: 'Some name 1', createdAt: 123 },
        { name: 'Some name 2', email: 'someemail2@example.com', createdAt: 456 },
      ]),
    );
    expect(sql).toBe(
      'INSERT INTO `User` (`id`, `name`, `createdAt`, `email`) VALUES (?, ?, ?, NULL), (NULL, ?, ?, ?) RETURNING `id` `id`',
    );
    expect(values).toEqual([5, 'Some name 1', 123, 'Some name 2', 456, 'someemail2@example.com']);
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
    expect(sql).toBe('INSERT INTO `ItemTag` (`id`) VALUES (?) ON CONFLICT (`id`) DO NOTHING RETURNING `id` `id`');
    expect(values).toEqual([1]);
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
      'INSERT INTO `User` (`name`, `email`, `createdAt`) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?) RETURNING `id` `id`',
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

  override shouldInsertWithOnInsertId() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.insert(ctx, TaxCategory, {
        name: 'Some Name',
        createdAt: 123,
      }),
    );
    expect(sql).toMatch(
      /^INSERT INTO `TaxCategory` \(`name`, `createdAt`, `pk`\) VALUES \(\?, \?, \?\) RETURNING `pk` `id`$/,
    );
    expect(values[0]).toBe('Some Name');
    expect(values[1]).toBe(123);
    expect(values[2]).toMatch(/.+/);
  }

  override shouldInsertManyWithSpecifiedIdsAndOnInsertIdAsDefault() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.insert(ctx, TaxCategory, [
        {
          name: 'Some Name A',
        },
        {
          pk: '50',
          name: 'Some Name B',
        },
        {
          name: 'Some Name C',
        },
        {
          pk: '70',
          name: 'Some Name D',
        },
      ]),
    );
    expect(sql).toMatch(
      /^INSERT INTO `TaxCategory` \(`name`, `createdAt`, `pk`\) VALUES \(\?, \?, \?\), \(\?, \?, \?\), \(\?, \?, \?\), \(\?, \?, \?\) RETURNING `pk` `id`$/,
    );
    expect(values[0]).toBe('Some Name A');
    expect(values[2]).toMatch(/.+/);
    expect(values[3]).toBe('Some Name B');
    expect(values[5]).toBe('50');
  }

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
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `id` = ? AND `something` = ? ORDER BY `id`, `something`');
    expect(res.values).toEqual([1, 1]);

    res = this.exec((ctx) =>
      this.dialect.insert(ctx, User, {
        name: 'Some Name',
        something: 'anything',
        createdAt: 1,
      } as any),
    );
    expect(res.sql).toBe('INSERT INTO `User` (`name`, `createdAt`) VALUES (?, ?) RETURNING `id` `id`');
    expect(res.values).toEqual(['Some Name', 1]);

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
    expect(res.sql).toBe('UPDATE `User` SET `name` = ?, `updatedAt` = ? WHERE `something` = ?');
    expect(res.values).toEqual(['Some Name', 1, 'anything']);

    res = this.exec((ctx) =>
      this.dialect.delete(ctx, User, {
        $where: { something: 'anything' } as any,
      }),
    );
    expect(res.sql).toBe('DELETE FROM `User` WHERE `something` = ?');
    expect(res.values).toEqual(['anything']);
  }

  override shouldFind$text() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { $text: { $fields: ['name', 'description'], $value: 'some text' }, companyId: 1 },
        $limit: 30,
      }),
    );
    expect(res.sql).toBe(
      'SELECT `id` FROM `Item` WHERE `Item` MATCH {`name` `description`} : ? AND `companyId` = ? LIMIT 30',
    );
    expect(res.values).toEqual(['some text', 1]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: 1 },
        $where: {
          $text: { $fields: ['name'], $value: 'something' },
          name: { $ne: 'other unwanted' },
          companyId: 1,
        },
        $limit: 10,
      }),
    );
    expect(res.sql).toBe(
      'SELECT `id` FROM `User` WHERE `User` MATCH {`name`} : ? AND `name` IS NOT ? AND `companyId` = ? LIMIT 10',
    );
    expect(res.values).toEqual(['something', 'other unwanted', 1]);
  }

  shouldHandleBoolean() {
    const { values } = this.exec((ctx) =>
      this.dialect.insert(ctx, Item, {
        inventoryable: true,
      }),
    );
    expect(values).toContain(1);

    const { values: values2 } = this.exec((ctx) =>
      this.dialect.insert(ctx, Item, {
        inventoryable: false,
      }),
    );
    expect(values2).toContain(0);
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
    expect(sql).toBe('SELECT `id` FROM `VectorItem` ORDER BY vec_distance_cosine(`vec`, ?) LIMIT 10');
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
    expect(sql).toBe('SELECT `id` FROM `VectorItem` ORDER BY vec_distance_L2(`vec`, ?) LIMIT 5');
    expect(values).toEqual(['[1,2,3]']);
  }

  shouldThrowForUnsupportedVectorDistanceMetric() {
    @Entity({ name: 'VectorItem' })
    class VectorItem {
      @Id() id?: number;
      @Field({ type: 'vector' }) vec!: number[];
    }
    expect(() =>
      this.exec((ctx) =>
        this.dialect.find(ctx, VectorItem, {
          $select: { id: true },
          $sort: { vec: { $vector: [1, 2, 3], $distance: 'inner' } },
          $limit: 10,
        }),
      ),
    ).toThrow('sqlite does not support vector distance metric: inner');
  }

  shouldNotResolveVectorDistanceFnViaThePrototypeChain() {
    @Entity({ name: 'VectorItem' })
    class VectorItem {
      @Id() id?: number;
      @Field({ type: 'vector' }) vec!: number[];
    }
    // 'toString' is not an own property of `vectorDistanceFns`, but `Object.prototype.toString`
    // exists - a naive bracket-access lookup would resolve it as if it were a supported metric.
    expect(() =>
      this.exec((ctx) =>
        this.dialect.find(ctx, VectorItem, {
          $select: { id: true },
          $sort: { vec: { $vector: [1, 2, 3], $distance: 'toString' as any } },
          $limit: 10,
        }),
      ),
    ).toThrow('sqlite does not support vector distance metric: toString');
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
      'SELECT `id` FROM `VectorItem` WHERE `name` = ? ORDER BY vec_distance_cosine(`vec`, ?), `name` DESC LIMIT 10',
    );
    expect(values).toEqual(['test', '[1,2,3]']);
  }

  shouldSortByVectorSimilarityWithEntityDefaultDistance() {
    @Entity({ name: 'VectorItem' })
    class VectorItem {
      @Id() id?: number;
      @Field({ type: 'vector', distance: 'l2' }) vec!: number[];
    }
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, VectorItem, {
        $select: { id: true },
        $sort: { vec: { $vector: [1, 2, 3] } },
        $limit: 10,
      }),
    );
    expect(sql).toBe('SELECT `id` FROM `VectorItem` ORDER BY vec_distance_L2(`vec`, ?) LIMIT 10');
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
        $sort: { vec: { $vector: [1, 2, 3], $project: 'distance' } },
        $limit: 10,
      }),
    );
    expect(sql).toBe(
      'SELECT `id`, vec_distance_cosine(`vec`, ?) AS `distance` FROM `VectorItem` ORDER BY `distance` LIMIT 10',
    );
    expect(values).toEqual(['[1,2,3]']);
  }

  shouldEscape() {
    expect(this.dialect.escape("it's")).toBe("'it''s'");
  }

  // JSON operator tests
  shouldFind$elemMatch() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $elemMatch: { city: 'NYC', zip: '10001' } } } as any,
      }),
    );
    expect(sql).toBe(
      "SELECT `id` FROM `User` WHERE EXISTS (SELECT 1 FROM json_each(`name`) uql_elem WHERE json_extract(value, '$.city') = ? AND json_extract(value, '$.zip') = ?)",
    );
    expect(values).toEqual(['NYC', '10001']);
  }

  shouldFind$all() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $all: ['admin', 'user'] } } as any,
      }),
    );
    expect(sql).toBe(
      'SELECT `id` FROM `User` WHERE (EXISTS (SELECT 1 FROM json_each(`name`) uql_elem WHERE `name` -> uql_elem.fullkey = json(?)) AND EXISTS (SELECT 1 FROM json_each(`name`) uql_elem WHERE `name` -> uql_elem.fullkey = json(?)))',
    );
    expect(values).toEqual(['"admin"', '"user"']);
  }

  shouldFind$size() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $size: 3 } } as any,
      }),
    );
    expect(sql).toBe('SELECT `id` FROM `User` WHERE json_array_length(`name`) = ?');
    expect(values).toEqual([3]);
  }

  shouldFind$sizeWithComparison() {
    // Single comparison operator
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $size: { $gte: 2 } } } as any,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE json_array_length(`name`) >= ?');
    expect(res.values).toEqual([2]);

    // Multiple comparison operators
    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $size: { $gt: 0, $lte: 5 } } } as any,
      }),
    );
    expect(res.sql).toBe(
      'SELECT `id` FROM `User` WHERE (json_array_length(`name`) > ? AND json_array_length(`name`) <= ?)',
    );
    expect(res.values).toEqual([0, 5]);

    // $between
    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $size: { $between: [1, 10] } } } as any,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE json_array_length(`name`) BETWEEN ? AND ?');
    expect(res.values).toEqual([1, 10]);
  }

  // Tests for $elemMatch with nested operators
  shouldFind$elemMatchWithOperators() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $elemMatch: { city: { $ilike: 'new%' } } } } as any,
      }),
    );
    expect(sql).toBe(
      "SELECT `id` FROM `User` WHERE EXISTS (SELECT 1 FROM json_each(`name`) uql_elem WHERE json_extract(value, '$.city') LIKE ?)",
    );
    expect(values).toEqual(['new%']);
  }

  shouldFind$elemMatchWithMultipleOperators() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $elemMatch: { price: { $lt: 100 }, active: { $eq: true } } } } as any,
      }),
    );
    expect(sql).toContain('EXISTS (SELECT 1 FROM json_each');
    expect(sql).toContain("CAST(json_extract(value, '$.price') AS REAL) < ?");
    expect(sql).toContain("value -> '$.active' = json(?)");
    // The boolean binds as JSON text, not as SQLite's 0/1 integer.
    expect(values).toEqual([100, 'true']);
  }

  shouldFind$elemMatchWithAllOperators() {
    // Test $ne, $gt, $gte, $lte
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: {
          name: {
            $elemMatch: {
              a: { $ne: 'x' },
              b: { $gt: 5 },
              c: { $gte: 10 },
              active: { $eq: true },
            },
          },
        } as any,
      }),
    );
    expect(res.sql).toContain("json_extract(value, '$.a') IS NOT ?");
    expect(res.sql).toContain("CAST(json_extract(value, '$.b') AS REAL) > ?");
    expect(res.sql).toContain("CAST(json_extract(value, '$.c') AS REAL) >= ?");
    expect(res.sql).toContain("value -> '$.active' = json(?)");
    expect(res.values).toContain('true');

    // Test $like, $startsWith, $endsWith
    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: {
          name: {
            $elemMatch: {
              a: { $like: '%x%' },
              b: { $startsWith: 'hi' },
              c: { $endsWith: 'bye' },
              d: { $istartsWith: 'HI' },
              e: { $iendsWith: 'BYE' },
              f: { $includes: 'mid' },
              g: { $iincludes: 'MID' },
            },
          },
        } as any,
      }),
    );
    expect(res.sql).toContain("json_extract(value, '$.a') LIKE ?");
    expect(res.sql).toContain("json_extract(value, '$.d') LIKE ?");
    expect(res.sql).toContain("json_extract(value, '$.e') LIKE ?");
    expect(res.sql).toContain("json_extract(value, '$.g') LIKE ?");

    // Test $regex
    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $elemMatch: { code: { $regex: '^A' } } } } as any,
      }),
    );
    expect(res.sql).toContain("json_extract(value, '$.code') REGEXP ?");
  }

  // ─── JSONB dot-notation (SQLite-specific json_extract syntax) ──────
  shouldFindByJsonDotNotation() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { 'kind.public': 1 } as any,
      }),
    );
    expect(sql).toBe("SELECT `id` FROM `Company` WHERE CAST(json_extract(`kind`, '$.public') AS REAL) = ?");
    expect(values).toEqual([1]);
  }

  shouldFindByJsonDotNotationWithOperator() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { 'kind.public': { $ne: 0 } } as any,
      }),
    );
    expect(sql).toBe("SELECT `id` FROM `Company` WHERE CAST(json_extract(`kind`, '$.public') AS REAL) IS NOT ?");
    expect(values).toEqual([0]);
  }

  shouldFindByJsonDotNotationWithNumericCast() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { 'kind.public': { $gt: 0 } } as any,
      }),
    );
    expect(sql).toBe("SELECT `id` FROM `Company` WHERE CAST(json_extract(`kind`, '$.public') AS REAL) > ?");
    expect(values).toEqual([0]);
  }

  shouldFindByJsonDotNotationDeepPath() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { 'kind.theme.color': 'red' } as any,
      }),
    );
    expect(sql).toBe("SELECT `id` FROM `Company` WHERE json_extract(`kind`, '$.theme.color') = ?");
    expect(values).toEqual(['red']);
  }

  shouldFindByJsonDotNotationWithIlike() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { 'kind.public': { $ilike: '%active%' } } as any,
      }),
    );
    // SQLite uses LOWER(...) LIKE for ILIKE
    expect(sql).toBe("SELECT `id` FROM `Company` WHERE json_extract(`kind`, '$.public') LIKE ?");
    expect(values).toEqual(['%active%']);
  }

  // ─── Relation filtering (SQLite-specific) ──────────────────────────
  shouldFindByManyToManyRelation() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { tags: { id: 5 } } as any,
      }),
    );
    expect(sql).toBe(
      'SELECT `id` FROM `Item` WHERE EXISTS (SELECT 1 FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id` AND `ItemTag`.`tagId` IN (SELECT `Tag`.`id` FROM `Tag` WHERE `Tag`.`id` = ?))',
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
    // MeasureUnitCategory has softDelete → parent query adds AND `deletedAt` IS NULL
    expect(sql).toBe(
      'SELECT `id` FROM `MeasureUnitCategory` WHERE EXISTS (SELECT 1 FROM `MeasureUnit` WHERE `MeasureUnit`.`categoryId` = `MeasureUnitCategory`.`id` AND `MeasureUnit`.`name` = ?) AND `deletedAt` IS NULL',
    );
    expect(values).toEqual(['kg']);
  }

  protected override readonly jsonUpdateCases: Record<JsonUpdateCaseName, { sql: string; values: unknown[] }> = {
    set: {
      sql: "UPDATE `Company` SET `kind` = json_set(COALESCE(`kind`, '{}'), '$.private', json(?)), `updatedAt` = ? WHERE `id` = ?",
      values: ['1', 123, 1],
    },
    unsetOnly: {
      sql: "UPDATE `Company` SET `kind` = json_remove(`kind`, '$.public', '$.private'), `updatedAt` = ? WHERE `id` = ?",
      values: [123, 1],
    },
    setUnsetCombined: {
      sql: "UPDATE `Company` SET `kind` = json_remove(json_set(COALESCE(`kind`, '{}'), '$.private', json(?)), '$.public'), `updatedAt` = ? WHERE `id` = ?",
      values: ['1', 123, 1],
    },
    push: {
      sql: "UPDATE `Company` SET `kind` = json_insert(`kind`, '$.tags[#]', json(?)), `updatedAt` = ? WHERE `id` = ?",
      values: ['"new-tag"', 123, 1],
    },
    /**
     * Elements are read back via `->` at their own `fullkey`, which preserves each element's JSON
     * type; `json_each`'s `value` column would flatten booleans to 0/1 and stringify objects.
     */
    pull: {
      sql: "UPDATE `Company` SET `kind` = json_replace(`kind`, '$.tags', (SELECT json_group_array(json(`kind` -> uql_pull.fullkey)) FROM json_each(`kind`, '$.tags') uql_pull WHERE `kind` -> uql_pull.fullkey <> json(?))), `updatedAt` = ? WHERE `id` = ?",
      values: ['"a"', 123, 1],
    },
    pullPushSameKey: {
      sql: "UPDATE `Company` SET `kind` = json_insert(json_replace(`kind`, '$.tags', (SELECT json_group_array(json(`kind` -> uql_pull.fullkey)) FROM json_each(`kind`, '$.tags') uql_pull WHERE `kind` -> uql_pull.fullkey <> json(?))), '$.tags[#]', json(?)), `updatedAt` = ? WHERE `id` = ?",
      values: ['"a"', '"b"', 123, 1],
    },
    setPushCombined: {
      sql: "UPDATE `Company` SET `kind` = json_insert(json_set(COALESCE(`kind`, '{}'), '$.private', json(?)), '$.tags[#]', json(?)), `updatedAt` = ? WHERE `id` = ?",
      values: ['1', '"new-tag"', 123, 1],
    },
    setPushSameKey: {
      sql: "UPDATE `Company` SET `kind` = json_insert(json_set(COALESCE(`kind`, '{}'), '$.tags', json(?)), '$.tags[#]', json(?)), `updatedAt` = ? WHERE `id` = ?",
      values: ['["a"]', '"b"', 123, 1],
    },
    pushUnsetCombined: {
      sql: "UPDATE `Company` SET `kind` = json_remove(json_insert(`kind`, '$.tags[#]', json(?)), '$.public'), `updatedAt` = ? WHERE `id` = ?",
      values: ['"new-tag"', 123, 1],
    },
  };

  shouldSortByJsonDotNotation() {
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $sort: { 'kind.public': 1 },
      }),
    );
    expect(sql).toBe("SELECT `id` FROM `Company` ORDER BY json_extract(`kind`, '$.public')");
  }

  shouldSortByJsonDotNotationDeep() {
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $sort: { 'kind.theme.color': -1 } as any,
      }),
    );
    expect(sql).toBe("SELECT `id` FROM `Company` ORDER BY json_extract(`kind`, '$.theme.color') DESC");
  }
}

createSpec(new SqliteDialectSpec());
