import { ObjectId } from 'mongodb';
import { Item, TaxCategory } from '../../entity/entityMock';
import { MongoDialect } from './mongoDialect';

let dialect: MongoDialect;

beforeEach(() => {
  dialect = new MongoDialect();
});

it('buildFilter empty', () => {
  const output = dialect.buildFilter(Item, {});
  expect(output).toEqual({});
});

it('buildFilter', () => {
  expect(
    dialect.buildFilter<Item>(Item, { code: '123' })
  ).toEqual({ code: '123' });
  expect(
    dialect.buildFilter<Item>(Item, { $and: { code: '123', name: 'abc' } })
  ).toEqual({ $and: [{ code: '123' }, { name: 'abc' }] });
  expect(
    dialect.buildFilter<Item>(Item, { id: '507f191e810c19729de860ea' })
  ).toEqual({ _id: new ObjectId('507f191e810c19729de860ea') });
  expect(
    dialect.buildFilter<Item>(Item, { id: new ObjectId('507f191e810c19729de860ea') as any })
  ).toEqual({ _id: new ObjectId('507f191e810c19729de860ea') });
  expect(
    dialect.buildFilter<TaxCategory>(TaxCategory, { id: '507f191e810c19729de860ea' })
  ).toEqual({ id: '507f191e810c19729de860ea' });
  expect(
    dialect.buildFilter<TaxCategory>(TaxCategory, { pk: '507f191e810c19729de860ea' })
  ).toEqual({ _id: new ObjectId('507f191e810c19729de860ea') });
  expect(
    dialect.buildFilter<TaxCategory>(TaxCategory, { pk: new ObjectId('507f191e810c19729de860ea') as any })
  ).toEqual({ _id: new ObjectId('507f191e810c19729de860ea') });
});

it('buildAggregationPipeline empty', () => {
  expect(dialect.buildAggregationPipeline(Item, {})).toEqual([]);
  expect(dialect.buildAggregationPipeline(Item, { filter: {} })).toEqual([]);
  expect(dialect.buildAggregationPipeline(Item, { populate: {} })).toEqual([]);
  expect(
    dialect.buildAggregationPipeline(Item, {
      filter: { code: '123' },
      populate: { measureUnit: null, tax: null },
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
        foreignField: 'id',
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
        foreignField: 'id',
        from: 'Tax',
        localField: 'tax',
      },
    },
    {
      $unwind: { path: '$tax', preserveNullAndEmptyArrays: true },
    },
  ]);
});
