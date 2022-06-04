import { Query, QueryFilter, QueryStringified } from '@uql/core/type';
import { Item } from '@uql/core/test';
import { parseQuery } from './query.util.js';

it('parseQuery -- empty', () => {
  const res1 = parseQuery(undefined);
  expect(res1).toEqual({});
  const res2 = parseQuery({});
  expect(res2).toEqual({});
});

it('parseQuery stringified', () => {
  const qms: QueryStringified = {
    $project: '{ "id": true, "name": true, "measureUnit": {"$project":{"id":true, "name":true}}, "tax": {"$project":{"id":true, "name":true}} }',
    $filter: '{ "name": "lorem", "companyId": 40 }',
    $group: '["companyId"]',
    $having: '{ "count": {"$gte": 10} }',
    $sort: '{ "name": -1, "companyId": 1 }',
    $skip: '200',
    $limit: '100',
  };
  const expected: Query<Item> = {
    $project: {
      id: true,
      name: true,
      measureUnit: { $project: { id: true, name: true } },
      tax: { $project: { id: true, name: true } },
    },
    $filter: { name: 'lorem', companyId: 40 },
    $group: ['companyId'],
    $having: { count: { $gte: 10 } } as QueryFilter<Item>,
    $sort: { name: -1, companyId: 1 },
    $skip: 200,
    $limit: 100,
  };
  const result = parseQuery(qms);
  expect(result).toEqual(expected);
});
