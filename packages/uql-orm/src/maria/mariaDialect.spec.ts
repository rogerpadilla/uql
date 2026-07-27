import { expect } from 'vitest';
import type { JsonUpdateCaseName } from '../dialect/abstractSqlDialect-spec.js';
import { MySqlFamilySpec } from '../dialect/mysqlFamilyDialect-spec.js';
import { Entity, Field, Id } from '../entity/index.js';
import { Company, InventoryAdjustment, ItemTag, TaxCategory, User } from '../test/index.js';
import { createSpec } from '../test/spec.util.js';
import { MariaDialect } from './mariaDialect.js';

export class MariaDialectSpec extends MySqlFamilySpec {
  constructor() {
    super(new MariaDialect({}));
  }

  protected override jsonCastText(operand: string): string {
    return `JSON_EXTRACT(${operand}, '$')`;
  }

  shouldFilterByJsonDotNotation() {
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, Company, {
      $select: { id: true },
      $where: {
        'kind.public': 1,
      },
    });
    expect(ctx.sql).toBe("SELECT `id` FROM `Company` WHERE CAST(JSON_VALUE(`kind`, '$.public') AS DECIMAL) = ?");
    expect(ctx.values).toEqual([1]);
  }

  shouldSortByJsonDotNotation() {
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, Company, {
      $select: { id: true },
      $sort: {
        'kind.theme.color': -1,
      } as any,
    });
    expect(ctx.sql).toBe("SELECT `id` FROM `Company` ORDER BY JSON_VALUE(`kind`, '$.theme.color') DESC");
  }

  shouldFilterByJsonDotNotationDeep() {
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, Company, {
      $select: { id: true },
      $where: {
        'kind.theme.color': 'red',
      } as any,
    });
    expect(ctx.sql).toBe("SELECT `id` FROM `Company` WHERE JSON_VALUE(`kind`, '$.theme.color') = ?");
    expect(ctx.values).toEqual(['red']);
  }

  /**
   * MariaDB needs `JSON_COMPACT` (bare `JSON_ARRAYAGG` re-quotes elements into strings) and
   * `JSON_EQUALS` (its JSON is text, so `<>` would compare textually).
   */
  protected override readonly jsonUpdateCases: Record<JsonUpdateCaseName, { sql: string; values: unknown[] }> = {
    set: {
      sql: "UPDATE `Company` SET `kind` = JSON_SET(COALESCE(`kind`, '{}'), '$.private', JSON_EXTRACT(?, '$')), `updatedAt` = ? WHERE `id` = ?",
      values: ['1', 123, 1],
    },
    unsetOnly: {
      sql: "UPDATE `Company` SET `kind` = JSON_REMOVE(`kind`, '$.public', '$.private'), `updatedAt` = ? WHERE `id` = ?",
      values: [123, 1],
    },
    setUnsetCombined: {
      sql: "UPDATE `Company` SET `kind` = JSON_REMOVE(JSON_SET(COALESCE(`kind`, '{}'), '$.private', JSON_EXTRACT(?, '$')), '$.public'), `updatedAt` = ? WHERE `id` = ?",
      values: ['1', 123, 1],
    },
    push: {
      sql: "UPDATE `Company` SET `kind` = JSON_MERGE_PRESERVE(`kind`, JSON_OBJECT('tags', JSON_ARRAY(JSON_EXTRACT(?, '$')))), `updatedAt` = ? WHERE `id` = ?",
      values: ['"new-tag"', 123, 1],
    },
    pull: {
      sql: "UPDATE `Company` SET `kind` = JSON_REPLACE(`kind`, '$.tags', (SELECT COALESCE(JSON_ARRAYAGG(JSON_COMPACT(uql_pull.v)), JSON_ARRAY()) FROM JSON_TABLE(`kind`, '$.tags[*]' COLUMNS (v JSON PATH '$')) uql_pull WHERE NOT JSON_EQUALS(uql_pull.v, JSON_EXTRACT(?, '$')))), `updatedAt` = ? WHERE `id` = ?",
      values: ['"a"', 123, 1],
    },
    pullPushSameKey: {
      sql: "UPDATE `Company` SET `kind` = JSON_MERGE_PRESERVE(JSON_REPLACE(`kind`, '$.tags', (SELECT COALESCE(JSON_ARRAYAGG(JSON_COMPACT(uql_pull.v)), JSON_ARRAY()) FROM JSON_TABLE(`kind`, '$.tags[*]' COLUMNS (v JSON PATH '$')) uql_pull WHERE NOT JSON_EQUALS(uql_pull.v, JSON_EXTRACT(?, '$')))), JSON_OBJECT('tags', JSON_ARRAY(JSON_EXTRACT(?, '$')))), `updatedAt` = ? WHERE `id` = ?",
      values: ['"a"', '"b"', 123, 1],
    },
    setPushCombined: {
      sql: "UPDATE `Company` SET `kind` = JSON_MERGE_PRESERVE(JSON_SET(COALESCE(`kind`, '{}'), '$.private', JSON_EXTRACT(?, '$')), JSON_OBJECT('tags', JSON_ARRAY(JSON_EXTRACT(?, '$')))), `updatedAt` = ? WHERE `id` = ?",
      values: ['1', '"new-tag"', 123, 1],
    },
    setPushSameKey: {
      sql: "UPDATE `Company` SET `kind` = JSON_MERGE_PRESERVE(JSON_SET(COALESCE(`kind`, '{}'), '$.tags', JSON_EXTRACT(?, '$')), JSON_OBJECT('tags', JSON_ARRAY(JSON_EXTRACT(?, '$')))), `updatedAt` = ? WHERE `id` = ?",
      values: ['["a"]', '"b"', 123, 1],
    },
    pushUnsetCombined: {
      sql: "UPDATE `Company` SET `kind` = JSON_REMOVE(JSON_MERGE_PRESERVE(`kind`, JSON_OBJECT('tags', JSON_ARRAY(JSON_EXTRACT(?, '$')))), '$.public'), `updatedAt` = ? WHERE `id` = ?",
      values: ['"new-tag"', 123, 1],
    },
  };

  shouldHandleDate() {
    const values: unknown[] = [];
    expect(this.dialect.addValue(values, new Date())).toBe('?');
    expect(values).toHaveLength(1);
    expect(values[0]).toBeInstanceOf(Date);
  }

  shouldEscape() {
    expect(this.dialect.escape("va'lue")).toBe("'va\\'lue'");
  }

  shouldHandleOtherValues() {
    const values: unknown[] = [];
    expect(this.dialect.addValue(values, 123)).toBe('?');
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
    ).toThrow('mariadb does not support vector distance metric: toString');
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

  override shouldInsertManyWithHeterogeneousColumns() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.insert(ctx, User, [
        { id: 5, name: 'Some name 1', createdAt: 123 },
        { name: 'Some name 2', email: 'someemail2@example.com', createdAt: 456 },
      ]),
    );
    expect(sql).toBe(
      'INSERT INTO `User` (`id`, `name`, `createdAt`, `email`) VALUES (?, ?, ?, DEFAULT), (DEFAULT, ?, ?, ?) RETURNING `id` `id`',
    );
    expect(values).toEqual([5, 'Some name 1', 123, 'Some name 2', 456, 'someemail2@example.com']);
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
