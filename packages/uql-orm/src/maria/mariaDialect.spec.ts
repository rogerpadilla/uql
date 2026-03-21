import { expect } from 'vitest';
import { AbstractSqlDialectSpec } from '../dialect/abstractSqlDialect-spec.js';
import { Entity, Field, Id } from '../entity/index.js';
import { Company, InventoryAdjustment, ItemTag, TaxCategory, User } from '../test/index.js';
import { createSpec } from '../test/spec.util.js';
import { MariaDialect } from './mariaDialect.js';

export class MariaDialectSpec extends AbstractSqlDialectSpec {
  constructor() {
    super(new MariaDialect());
  }

  // JSON operator tests
  shouldFind$elemMatch() {
    const dialect = new MariaDialect();
    const ctx = dialect.createContext();
    dialect.find(ctx, User, {
      $select: { id: true },
      $where: { name: { $elemMatch: { city: 'NYC' } } },
    });
    expect(ctx.sql).toBe('SELECT `id` FROM `User` WHERE JSON_CONTAINS(`name`, ?)');
    expect(ctx.values).toEqual(['[{"city":"NYC"}]']);
  }

  shouldFind$all() {
    const dialect = new MariaDialect();
    const ctx = dialect.createContext();
    dialect.find(ctx, User, {
      $select: { id: true },
      $where: { name: { $all: ['admin', 'user'] } },
    });
    expect(ctx.sql).toBe('SELECT `id` FROM `User` WHERE JSON_CONTAINS(`name`, ?)');
    expect(ctx.values).toEqual(['["admin","user"]']);
  }

  shouldFind$size() {
    const dialect = new MariaDialect();
    const ctx = dialect.createContext();
    dialect.find(ctx, User, {
      $select: { id: true },
      $where: { name: { $size: 3 } },
    });
    expect(ctx.sql).toBe('SELECT `id` FROM `User` WHERE JSON_LENGTH(`name`) = ?');
    expect(ctx.values).toEqual([3]);
  }

  shouldFind$sizeWithComparison() {
    const dialect = new MariaDialect();

    // Single comparison operator
    let ctx = dialect.createContext();
    dialect.find(ctx, User, {
      $select: { id: true },
      $where: { name: { $size: { $gte: 2 } } },
    });
    expect(ctx.sql).toBe('SELECT `id` FROM `User` WHERE JSON_LENGTH(`name`) >= ?');
    expect(ctx.values).toEqual([2]);

    // Multiple comparison operators
    ctx = dialect.createContext();
    dialect.find(ctx, User, {
      $select: { id: true },
      $where: { name: { $size: { $gt: 0, $lte: 5 } } },
    });
    expect(ctx.sql).toBe('SELECT `id` FROM `User` WHERE (JSON_LENGTH(`name`) > ? AND JSON_LENGTH(`name`) <= ?)');
    expect(ctx.values).toEqual([0, 5]);

    // $between
    ctx = dialect.createContext();
    dialect.find(ctx, User, {
      $select: { id: true },
      $where: { name: { $size: { $between: [1, 10] } } },
    });
    expect(ctx.sql).toBe('SELECT `id` FROM `User` WHERE JSON_LENGTH(`name`) BETWEEN ? AND ?');
    expect(ctx.values).toEqual([1, 10]);
  }

  // Tests for $elemMatch with nested operators
  shouldFind$elemMatchWithOperators() {
    const dialect = new MariaDialect();
    const ctx = dialect.createContext();
    dialect.find(ctx, User, {
      $select: { id: true },
      $where: { name: { $elemMatch: { city: { $like: 'New%' } } } },
    });
    expect(ctx.sql).toBe(
      "SELECT `id` FROM `User` WHERE EXISTS (SELECT 1 FROM JSON_TABLE(`name`, '$[*]' COLUMNS (`city` TEXT PATH '$.city')) AS jt WHERE jt.`city` LIKE ?)",
    );
    expect(ctx.values).toEqual(['New%']);
  }

  shouldFind$elemMatchWithMultipleOperators() {
    const dialect = new MariaDialect();
    const ctx = dialect.createContext();
    dialect.find(ctx, User, {
      $select: { id: true },
      $where: { name: { $elemMatch: { price: { $gte: 50 }, active: { $ne: false } } } },
    });
    expect(ctx.sql).toContain('EXISTS (SELECT 1 FROM JSON_TABLE');
    expect(ctx.sql).toContain('CAST(jt.`price` AS DECIMAL) >= ?');
    expect(ctx.sql).toContain('jt.`active` <> ?');
  }

  shouldFind$elemMatchWithAllOperators() {
    const dialect = new MariaDialect();
    const ctx = dialect.createContext();
    dialect.find(ctx, User, {
      $select: { id: true },
      $where: {
        name: {
          $elemMatch: {
            a: { $eq: 'x' },
            b: { $gt: 5 },
            c: { $lt: 10 },
            d: { $lte: 20 },
            e: { $like: '%test%' },
            f: { $ilike: 'HI' },
            g: { $startsWith: 'abc' },
            h: { $istartsWith: 'ABC' },
            i: { $endsWith: 'xyz' },
            j: { $iendsWith: 'XYZ' },
            k: { $includes: 'mid' },
            l: { $iincludes: 'MID' },
            m: { $regex: '^A' },
            n: { $in: [1, 2] },
            o: { $nin: [3, 4] },
          },
        },
      },
    });

    expect(ctx.sql).toContain('jt.`a` = ?');
    expect(ctx.sql).toContain('CAST(jt.`b` AS DECIMAL) > ?');
    expect(ctx.sql).toContain('CAST(jt.`c` AS DECIMAL) < ?');
    expect(ctx.sql).toContain('CAST(jt.`d` AS DECIMAL) <= ?');
    expect(ctx.sql).toContain('jt.`e` LIKE ?');
    expect(ctx.sql).toContain('jt.`f` LIKE ?');
    expect(ctx.sql).toContain('jt.`m` REGEXP ?');
    expect(ctx.sql).toContain('jt.`n` IN (');
    expect(ctx.sql).toContain('jt.`o` NOT IN (');
  }

  shouldFilterByJsonDotNotation() {
    const dialect = new MariaDialect();
    const ctx = dialect.createContext();
    dialect.find(ctx, Company, {
      $select: { id: true },
      $where: {
        'kind.public': 1,
      },
    });
    expect(ctx.sql).toBe("SELECT `id` FROM `Company` WHERE JSON_VALUE(`kind`, '$.public') = ?");
    expect(ctx.values).toEqual([1]);
  }

  shouldSortByJsonDotNotation() {
    const dialect = new MariaDialect();
    const ctx = dialect.createContext();
    dialect.find(ctx, Company, {
      $select: { id: true },
      $sort: {
        'kind.theme.color': -1,
      } as any,
    });
    expect(ctx.sql).toBe("SELECT `id` FROM `Company` ORDER BY JSON_VALUE(`kind`, '$.theme.color') DESC");
  }

  shouldFilterByJsonDotNotationDeep() {
    const dialect = new MariaDialect();
    const ctx = dialect.createContext();
    dialect.find(ctx, Company, {
      $select: { id: true },
      $where: {
        'kind.theme.color': 'red',
      } as any,
    });
    expect(ctx.sql).toBe("SELECT `id` FROM `Company` WHERE JSON_VALUE(`kind`, '$.theme.color') = ?");
    expect(ctx.values).toEqual(['red']);
  }

  shouldHandleDate() {
    const dialect = new MariaDialect();
    const values: unknown[] = [];
    expect(dialect.addValue(values, new Date())).toBe('?');
    expect(values).toHaveLength(1);
    expect(values[0]).toBeInstanceOf(Date);
  }

  shouldEscape() {
    const dialect = new MariaDialect();
    expect(dialect.escape("va'lue")).toBe("'va\\'lue'");
  }

  shouldHandleOtherValues() {
    const dialect = new MariaDialect();
    const values: unknown[] = [];
    expect(dialect.addValue(values, 123)).toBe('?');
    expect(values[0]).toBe(123);
  }

  shouldUpsertWithNoUpdateFields() {
    const { sql } = this.exec((ctx) => this.dialect.upsert(ctx, ItemTag, { id: true }, { id: 123 }));
    expect(sql).toContain('INSERT IGNORE');
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
    expect(sql).toBe('SELECT `id` FROM `VectorItem` ORDER BY VEC_DISTANCE_COSINE(`vec`, ?) LIMIT 10');
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
    expect(sql).toBe('SELECT `id` FROM `VectorItem` ORDER BY VEC_DISTANCE_EUCLIDEAN(`vec`, ?) LIMIT 5');
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
    ).toThrow('mariadb does not support vector distance metric: inner');
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
      'SELECT `id` FROM `VectorItem` WHERE `name` = ? ORDER BY VEC_DISTANCE_COSINE(`vec`, ?), `name` DESC LIMIT 10',
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
    expect(sql).toBe('SELECT `id` FROM `VectorItem` ORDER BY VEC_DISTANCE_EUCLIDEAN(`vec`, ?) LIMIT 10');
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
      'SELECT `id`, VEC_DISTANCE_COSINE(`vec`, ?) AS `distance` FROM `VectorItem` ORDER BY `distance` LIMIT 10',
    );
    expect(values).toEqual(['[1,2,3]']);
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

  override shouldUpsert() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        User,
        { email: true },
        {
          name: 'Some Name',
          email: 'someemail@example.com',
          createdAt: 123,
        },
      ),
    );
    expect(sql).toBe(
      'INSERT INTO `User` (`name`, `email`, `createdAt`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `createdAt` = VALUES(`createdAt`), `updatedAt` = ? RETURNING `id` `id`',
    );
    expect(values).toEqual(['Some Name', 'someemail@example.com', 123, expect.any(Number)]);
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
    expect(values).toEqual([
      'Some Name A',
      expect.any(Number),
      expect.any(String),
      'Some Name B',
      expect.any(Number),
      '50',
      'Some Name C',
      expect.any(Number),
      expect.any(String),
      'Some Name D',
      expect.any(Number),
      '70',
    ]);
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
        date: new Date(2021, 11, 31, 23, 59, 59, 999),
        createdAt: 123,
      }),
    );
    expect(res.sql).toBe('INSERT INTO `InventoryAdjustment` (`date`, `createdAt`) VALUES (?, ?) RETURNING `id` `id`');
    expect(res.values).toEqual([new Date(2021, 11, 31, 23, 59, 59, 999), 123]);
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
    expect(values).toEqual(['Some Name', 123, expect.any(String)]);
  }
}

createSpec(new MariaDialectSpec());
