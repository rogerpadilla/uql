import type { Request } from 'express';
import type { Item } from '../test/index.js';
import type { Query, QueryStringified } from '../type/index.js';
import { parseQuery } from './query.util.js';

it('parseQuery -- empty', () => {
  const req1 = {} as Request;
  parseQuery(req1);
  expect(req1).toEqual({ query: { $where: {} } });
  const req2 = { query: undefined as object } as Request;
  parseQuery(req2);
  expect(req2).toEqual({ query: { $where: {} } });
});

it('parseQuery stringified', () => {
  const queryStr = {
    $select:
      '{ "id": true, "name": true, "measureUnit": {"$select":{"id":true, "name":true}}, "tax": {"$select":{"id":true, "name":true}} }',
    $where: '{ "name": "lorem", "companyId": 40 }',
    $sort: '{ "name": -1, "companyId": 1 }',
    $skip: '200',
    $limit: '100',
  } satisfies QueryStringified;
  const query = {
    $select: {
      id: true,
      name: true,
      measureUnit: { $select: { id: true, name: true } },
      tax: { $select: { id: true, name: true } },
    },
    $where: { name: 'lorem', companyId: 40 },
    $sort: { name: -1, companyId: 1 },
    $skip: 200,
    $limit: 100,
  } satisfies Query<Item>;
  const req = { query: queryStr } as unknown as Request;
  parseQuery(req);
  expect(req).toEqual({ query });
});
