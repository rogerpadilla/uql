import { Item } from '../../entity/entityMock';
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
