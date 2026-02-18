import { ObjectId } from 'mongodb';
import { expect } from 'vitest';
import { getMeta } from '../entity/index.js';
import { createSpec, Item, type Spec, Tax, TaxCategory, User } from '../test/index.js';
import { MongoDialect } from './mongoDialect.js';

class MongoDialectSpec implements Spec {
  dialect!: MongoDialect;

  beforeEach() {
    this.dialect = new MongoDialect();
  }

  shouldBuildWhere() {
    expect(this.dialect.where(Item, undefined)).toEqual({});

    expect(this.dialect.where(Item, {})).toEqual({});

    expect(this.dialect.where(Item, { code: '123' })).toEqual({ code: '123' });

    expect(this.dialect.where(Item, { $and: [{ code: '123', name: 'abc' }] })).toEqual({
      $and: [{ code: '123', name: 'abc' }],
    });

    expect(
      this.dialect.where(TaxCategory, {
        creatorId: 1,
        $or: [{ name: { $in: ['a', 'b', 'c'] } }, { name: 'abc' }],
        pk: '507f191e810c19729de860ea',
      }),
    ).toEqual({
      creatorId: 1,
      $or: [{ name: { $in: ['a', 'b', 'c'] } }, { name: 'abc' }],
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    expect(this.dialect.where(Item, '507f191e810c19729de860ea' as any)).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    expect(this.dialect.where(Item, { id: '507f191e810c19729de860ea' as any })).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    expect(this.dialect.where(Item, { id: new ObjectId('507f191e810c19729de860ea') as any })).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    expect(this.dialect.where(TaxCategory, '507f191e810c19729de860ea')).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    expect(this.dialect.where(TaxCategory, { pk: '507f191e810c19729de860ea' })).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    expect(this.dialect.where(TaxCategory, { pk: new ObjectId('507f191e810c19729de860ea') as any })).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });
  }

  shouldSelect() {
    expect(this.dialect.select(Tax, { name: true })).toEqual({ name: true });
    expect(this.dialect.select(Tax, ['id', 'name'])).toEqual({ id: true, name: true });
  }

  shouldBuildSort() {
    expect(this.dialect.sort(Item, {})).toEqual({});
    expect(this.dialect.sort(Item, { code: 1 })).toEqual({ code: 1 });
    expect(this.dialect.sort(Item, { code: -1 })).toEqual({ code: -1 });
    expect(this.dialect.sort(Item, { code: 1 })).toEqual({ code: 1 });
    expect(this.dialect.sort(Item, [{ field: 'code', sort: -1 }])).toEqual({ code: -1 });
    expect(
      this.dialect.sort(Item, [
        ['name', 1],
        ['createdAt', -1],
      ]),
    ).toEqual({ name: 1, createdAt: -1 });
    expect(
      this.dialect.sort(Item, [
        ['name', -1],
        ['createdAt', -1],
      ]),
    ).toEqual({ name: -1, createdAt: -1 });
  }

  shouldNormalizeIds() {
    const meta = getMeta(User);
    expect(
      this.dialect.normalizeIds(meta, [
        { _id: 'abc' } as Partial<User> as User,
        { _id: 'def' } as Partial<User> as User,
      ]),
    ).toMatchObject([{ id: 'abc' }, { id: 'def' }]);
    expect(this.dialect.normalizeIds(meta, undefined)).toBe(undefined);
    expect(this.dialect.normalizeId(meta, undefined)).toBe(undefined);
    expect(
      this.dialect.normalizeId(meta, { _id: 'abc', company: {}, users: [] } as Partial<User> as User),
    ).toMatchObject({
      id: 'abc',
      company: {},
      users: [],
    });
  }

  shouldBuildAggregationPipeline() {
    expect(this.dialect.aggregationPipeline(Item, {})).toEqual([]);

    expect(this.dialect.aggregationPipeline(Item, { $where: {} })).toEqual([]);

    expect(this.dialect.aggregationPipeline(Item, {})).toEqual([]);

    expect(this.dialect.aggregationPipeline(Item, { $sort: { code: 1 } })).toEqual([{ $sort: { code: 1 } }]);

    expect(this.dialect.aggregationPipeline(User, { $select: { users: true } })).toEqual([]);

    expect(
      this.dialect.aggregationPipeline(TaxCategory, {
        $select: { creator: true },
        $where: { pk: '507f1f77bcf86cd799439011' },
        $sort: { creatorId: -1 },
      }),
    ).toEqual([
      {
        $match: {
          _id: new ObjectId('507f1f77bcf86cd799439011'),
        },
        $sort: {
          creatorId: -1,
        },
      },
      {
        $lookup: {
          from: 'User',
          localField: 'creatorId',
          foreignField: '_id',
          as: 'creator',
        },
      },
      {
        $unwind: {
          path: '$creator',
          preserveNullAndEmptyArrays: true,
        },
      },
    ]);

    expect(
      this.dialect.aggregationPipeline(Item, {
        $select: { measureUnit: true, tax: true },
        $where: { code: '123' },
      }),
    ).toEqual([
      {
        $match: {
          code: '123',
        },
      },
      {
        $lookup: {
          as: 'measureUnit',
          foreignField: '_id',
          from: 'MeasureUnit',
          localField: 'measureUnitId',
        },
      },
      {
        $unwind: { path: '$measureUnit', preserveNullAndEmptyArrays: true },
      },
      {
        $lookup: {
          as: 'tax',
          foreignField: '_id',
          from: 'Tax',
          localField: 'taxId',
        },
      },
      {
        $unwind: { path: '$tax', preserveNullAndEmptyArrays: true },
      },
    ]);

    expect(
      this.dialect.aggregationPipeline(User, {
        $select: { profile: true },
        $where: '65496146f8f7899f63768df1' as any,
        $limit: 1,
      }),
    ).toEqual([
      {
        $match: {
          _id: new ObjectId('65496146f8f7899f63768df1'),
        },
      },
      {
        $lookup: {
          from: 'user_profile',
          pipeline: [
            {
              $match: {
                creatorId: new ObjectId('65496146f8f7899f63768df1'),
              },
            },
          ],
          as: 'profile',
        },
      },
      {
        $unwind: {
          path: '$profile',
          preserveNullAndEmptyArrays: true,
        },
      },
    ]);

    expect(
      this.dialect.aggregationPipeline(User, {
        $select: { profile: true },
        $where: { id: '65496146f8f7899f63768df1' as any },
        $limit: 1,
      }),
    ).toEqual([
      {
        $match: {
          _id: new ObjectId('65496146f8f7899f63768df1'),
        },
      },
      {
        $lookup: {
          from: 'user_profile',
          pipeline: [
            {
              $match: {
                creatorId: new ObjectId('65496146f8f7899f63768df1'),
              },
            },
          ],
          as: 'profile',
        },
      },
      {
        $unwind: {
          path: '$profile',
          preserveNullAndEmptyArrays: true,
        },
      },
    ]);

    // Test referenceSort branch for 11 relation with $sort
    expect(
      this.dialect.aggregationPipeline(User, {
        $select: { profile: true },
        $where: { id: '65496146f8f7899f63768df1' as any },
        $sort: { name: 1 },
        $limit: 1,
      }),
    ).toEqual([
      {
        $match: {
          _id: new ObjectId('65496146f8f7899f63768df1'),
        },
        $sort: {
          name: 1,
        },
      },
      {
        $lookup: {
          from: 'user_profile',
          pipeline: [
            {
              $match: {
                creatorId: new ObjectId('65496146f8f7899f63768df1'),
              },
              $sort: {
                name: 1,
              },
            },
          ],
          as: 'profile',
        },
      },
      {
        $unwind: {
          path: '$profile',
          preserveNullAndEmptyArrays: true,
        },
      },
    ]);
  }

  // New operator tests
  shouldTransformBetweenOperator() {
    const result = this.dialect.where(Item, { createdAt: { $between: [100, 200] } });
    expect(result).toEqual({
      createdAt: { $gte: 100, $lte: 200 },
    });
  }

  shouldTransformIsNullOperator() {
    expect(this.dialect.where(Item, { name: { $isNull: true } })).toEqual({
      name: { $eq: null },
    });
    expect(this.dialect.where(Item, { name: { $isNull: false } })).toEqual({
      name: { $ne: null },
    });
  }

  shouldTransformIsNotNullOperator() {
    expect(this.dialect.where(Item, { name: { $isNotNull: true } })).toEqual({
      name: { $ne: null },
    });
    expect(this.dialect.where(Item, { name: { $isNotNull: false } })).toEqual({
      name: { $eq: null },
    });
  }

  shouldPassThroughAllOperator() {
    const result = this.dialect.where(Item, { name: { $all: ['a', 'b', 'c'] } } as any);
    expect(result).toEqual({
      name: { $all: ['a', 'b', 'c'] },
    });
  }

  shouldPassThroughSizeOperator() {
    const result = this.dialect.where(Item, { name: { $size: 3 } } as any);
    expect(result).toEqual({
      name: { $size: 3 },
    });
  }

  shouldPassThroughElemMatchOperator() {
    const result = this.dialect.where(Item, { name: { $elemMatch: { foo: 'bar' } } } as any);
    expect(result).toEqual({
      name: { $elemMatch: { foo: 'bar' } },
    });
  }

  shouldTransformStringOperatorsToRegex() {
    expect(this.dialect.where(Item, { name: { $startsWith: 'abc' } })).toEqual({
      name: { $regex: '^abc' },
    });
    expect(this.dialect.where(Item, { name: { $endsWith: 'xyz' } })).toEqual({
      name: { $regex: 'xyz$' },
    });
    expect(this.dialect.where(Item, { name: { $includes: 'test' } })).toEqual({
      name: { $regex: 'test' },
    });
    expect(this.dialect.where(Item, { name: { $like: '%test%' } })).toEqual({
      name: { $regex: '.*test.*' },
    });
    // Case-insensitive operators
    expect(this.dialect.where(Item, { name: { $istartsWith: 'abc' } })).toEqual({
      name: { $regex: '^abc', $options: 'i' },
    });
    expect(this.dialect.where(Item, { name: { $iendsWith: 'xyz' } })).toEqual({
      name: { $regex: 'xyz$', $options: 'i' },
    });
    expect(this.dialect.where(Item, { name: { $iincludes: 'test' } })).toEqual({
      name: { $regex: 'test', $options: 'i' },
    });
    expect(this.dialect.where(Item, { name: { $iincludes: 'data' } })).toEqual({
      name: { $regex: 'data', $options: 'i' },
    });
    expect(this.dialect.where(Item, { name: { $includes: 'val' } })).toEqual({
      name: { $regex: 'val' },
    });
    expect(this.dialect.where(Item, { name: { $ilike: '%test%' } })).toEqual({
      name: { $regex: '.*test.*', $options: 'i' },
    });
  }

  shouldTransformTextOperator() {
    expect(this.dialect.where(Item, { name: { $text: 'search' } } as any)).toEqual({
      name: { $text: { $search: 'search' } },
    });
  }

  shouldMapTableNameRow() {
    expect((this.dialect as any).mapTableNameRow({ table_name: 'users' })).toBe('users');
  }
}

createSpec(new MongoDialectSpec());
