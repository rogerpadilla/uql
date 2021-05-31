import { ObjectId } from 'mongodb';
import { Item, Spec, TaxCategory, User, createSpec } from '@uql/core/test';
import { MongoDialect } from './mongoDialect';

class MongoDialectSpec implements Spec {
  dialect: MongoDialect;

  beforeEach() {
    this.dialect = new MongoDialect();
  }

  shouldBuildFilter() {
    const output = this.dialect.buildFilter(Item, {});

    expect(output).toEqual({});

    expect(this.dialect.buildFilter(Item, { code: '123' })).toEqual({ code: '123' });

    expect(this.dialect.buildFilter(Item, { $and: [{ code: '123', name: 'abc' }] })).toEqual({
      $and: [{ code: '123', name: 'abc' }],
    });

    expect(
      this.dialect.buildFilter(User, {
        userId: '1',
        $or: [{ name: { $in: ['a', 'b', 'c'] } }, { email: 'abc@example.com' }],
        id: '507f191e810c19729de860ea',
      })
    ).toEqual({
      userId: '1',
      $or: [{ name: { $in: ['a', 'b', 'c'] } }, { email: 'abc@example.com' }],
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    expect(this.dialect.buildFilter(Item, { id: '507f191e810c19729de860ea' })).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    expect(this.dialect.buildFilter(Item, { id: new ObjectId('507f191e810c19729de860ea') as any })).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    expect(this.dialect.buildFilter(TaxCategory, { id: '507f191e810c19729de860ea' })).toEqual({
      id: '507f191e810c19729de860ea',
    });

    expect(this.dialect.buildFilter(TaxCategory, { pk: '507f191e810c19729de860ea' })).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });

    expect(this.dialect.buildFilter(TaxCategory, { pk: new ObjectId('507f191e810c19729de860ea') as any })).toEqual({
      _id: new ObjectId('507f191e810c19729de860ea'),
    });
  }

  shouldBuildAggregationPipeline() {
    expect(this.dialect.buildAggregationPipeline(Item, {})).toEqual([]);

    expect(this.dialect.buildAggregationPipeline(Item, { $filter: {} })).toEqual([]);

    expect(this.dialect.buildAggregationPipeline(Item, { $populate: {} })).toEqual([]);

    expect(() =>
      this.dialect.buildAggregationPipeline(User, {
        $populate: { status: {} } as any,
      })
    ).toThrow("'User.status' is not annotated as a relation");

    expect(
      this.dialect.buildAggregationPipeline(Item, {
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
          localField: 'measureUnit',
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
          localField: 'tax',
        },
      },
      {
        $unwind: { path: '$tax', preserveNullAndEmptyArrays: true },
      },
    ]);
  }
}

createSpec(new MongoDialectSpec());
