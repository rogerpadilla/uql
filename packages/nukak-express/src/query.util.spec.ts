import type { Request } from 'express';
import type { Query, QueryFilter, QueryStringified } from 'nukak/type';
import { Item } from 'nukak/test';
import { parseQuery } from './query.util.js';

it('parseQuery -- empty', () => {
  const req1 = {} as Request;
  parseQuery(req1);
  expect(req1).toEqual({ query: { $filter: {} } });
  const req2 = { query: undefined as object } as Request;
  parseQuery(req2);
  expect(req2).toEqual({ query: { $filter: {} } });
});

it('parseQuery stringified', () => {
  const queryStr = {
    $project: '{ "id": true, "name": true, "measureUnit": {"$project":{"id":true, "name":true}}, "tax": {"$project":{"id":true, "name":true}} }',
    $filter: '{ "name": "lorem", "companyId": 40 }',
    $group: '["companyId"]',
    $having: '{ "count": {"$gte": 10} }',
    $sort: '{ "name": -1, "companyId": 1 }',
    $skip: '200',
    $limit: '100',
  } satisfies QueryStringified;
  const query = {
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
  } satisfies Query<Item>;
  const req = { query: queryStr } as unknown as Request;
  parseQuery(req);
  expect(req).toEqual({ query });
});
