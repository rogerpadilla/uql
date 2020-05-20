import { Item } from '../../entity/entityMock';
import { buildFilter, buildAggregationPipeline } from './mongodb.util';

it('buildFilter empty', () => {
  const output = buildFilter({});
  expect(output).toEqual({});
});

it('buildFilter', () => {
  expect(
    buildFilter<Item>({ code: '123' })
  ).toEqual({ code: '123' });
  expect(
    buildFilter<Item>({ $and: { code: '123', name: 'abc' } })
  ).toEqual({ $and: [{ code: '123' }, { name: 'abc' }] });
});

it('buildAggregationPipeline empty', () => {
  expect(buildAggregationPipeline(Item, {})).toEqual([]);
  expect(buildAggregationPipeline(Item, { filter: {} })).toEqual([]);
  expect(buildAggregationPipeline(Item, { populate: {} })).toEqual([]);
  expect(buildAggregationPipeline(Item, { filter: { code: '123' }, populate: { measureUnit: null, tax: null } })).toEqual([
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
