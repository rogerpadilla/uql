import { Query, QueryStringified } from '@uql/core/type';
import { Item } from '@uql/core/test';
import { parseQuery } from './query.util';

it('parseQuery -- empty', () => {
  const res1 = parseQuery(undefined);
  expect(res1).toEqual({});
  const res2 = parseQuery({});
  expect(res2).toEqual({});
});

it('parseQuery stringified', () => {
  const qms: QueryStringified = {
    project: '{ "id": 1, "name": 1 }',
    filter: '{ "name": "Batman", "companyId": "40" }',
    populate: '{ "measureUnit": {"project":{"id":1, "name":1}}, "tax": {"project":{"id":1, "name":1}} }',
    group: '["companyId"]',
    sort: '{ "name": -1, "companyId": 1 }',
    skip: '200',
    limit: '100',
  };
  const expected: Query<Item> = {
    project: { id: 1, name: 1 },
    filter: { name: 'Batman', companyId: '40' },
    populate: {
      measureUnit: { project: { id: 1, name: 1 } },
      tax: { project: { id: 1, name: 1 } },
    },
    group: ['companyId'],
    sort: { name: -1, companyId: 1 },
    skip: 200,
    limit: 100,
  };
  const result = parseQuery(qms);
  expect(result).toEqual(expected);
});
