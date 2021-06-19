import { ObjectId } from 'mongodb';
import { Item, Spec, TaxCategory, User, createSpec, InventoryAdjustment, Tax } from '@uql/core/test';
import { getMeta } from '@uql/core/entity/decorator';
import { MongoDialect } from './mongoDialect';

class MongoDialectSpec implements Spec {
  dialect: MongoDialect;

  beforeEach() {
    this.dialect = new MongoDialect();
  }

  shouldBuildFilter() {
    expect(this.dialect.filter(Item, undefined)).toEqual({});

    expect(this.dialect.filter(Item, {})).toEqual({});

    expect(this.dialect.filter(Item, { code: '123' })).toEqual({ code: '123' });

    expect(this.dialect.filter(Item, { $and: [{ code: '123', name: 'abc' }] })).toEqual({
      $and: [{ code: '123', name: 'abc' }],
    });

    expect(
      this.dialect.filter(TaxCategory, {
        creatorId: 1,
        $or: [{ name: { $in: ['a', 'b', 'c'] } }, { name: 'abc' }],
        pk: '507f191e810c19729de860ea',
      })
    ).toEqual({
      creatorId: 1,
      $or: [{ name: { $in: ['a', 'b', 'c'] } }, { name: 'abc' }],
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    expect(this.dialect.filter(Item, { id: '507f191e810c19729de860ea' as any })).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    expect(this.dialect.filter(Item, { id: new ObjectId('507f191e810c19729de860ea') as any })).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    expect(this.dialect.filter(TaxCategory, { pk: '507f191e810c19729de860ea' })).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    expect(this.dialect.filter(TaxCategory, { pk: new ObjectId('507f191e810c19729de860ea') as any })).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });
  }

  shouldProject() {
    expect(this.dialect.project(Tax, { name: true })).toEqual({ name: true });
    expect(this.dialect.project(Tax, ['id', 'name'])).toEqual({ id: true, name: true });
  }

  shouldNormalizeIds() {
    const meta = getMeta(User);
    expect(this.dialect.normalizeIds(meta, [{ _id: 'abc' } as User, { _id: 'def' } as User])).toEqual([
      { id: 'abc' },
      { id: 'def' },
    ]);
    expect(this.dialect.normalizeIds(meta, undefined)).toBe(undefined);
    expect(this.dialect.normalizeId(meta, undefined)).toBe(undefined);
    expect(this.dialect.normalizeId(meta, { _id: 'abc', company: {}, users: [] } as User)).toEqual({
      id: 'abc',
      company: {},
      users: [],
    });
  }

  shouldBuildAggregationPipeline() {
    expect(this.dialect.aggregationPipeline(Item, {})).toEqual([]);

    expect(this.dialect.aggregationPipeline(Item, { $filter: {} })).toEqual([]);

    expect(this.dialect.aggregationPipeline(Item, { $populate: {} })).toEqual([]);

    expect(
      this.dialect.aggregationPipeline(User, {
        $populate: { users: {} },
      })
    ).toEqual([]);

    expect(() =>
      this.dialect.aggregationPipeline(User, {
        $populate: { creatorId: {} } as any,
      })
    ).toThrow("'User.creatorId' is not annotated as a relation");

    expect(
      this.dialect.aggregationPipeline(TaxCategory, {
        $filter: { pk: '507f1f77bcf86cd799439011' },
        $populate: { creator: {} },
      })
    ).toEqual([
      {
        $match: {
          _id: new ObjectId('507f1f77bcf86cd799439011'),
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
        $filter: { code: '123' },
        $populate: { measureUnit: {}, tax: {} },
      })
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
  }
}

createSpec(new MongoDialectSpec());
