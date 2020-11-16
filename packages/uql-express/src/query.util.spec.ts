import { Query, QueryStringified } from 'uql/type';
import { Item } from 'uql/test';
import { parseQuery } from './query.util';

it('buildQuery -- empty', () => {
  const res1 = parseQuery(undefined);
  expect(res1).toEqual({});
  const res2 = parseQuery({});
  expect(res2).toEqual({});
});

it('parseQuery stringified', () => {
  const qms: QueryStringified = {
    project: '{ "id": 1, "name": 1 }',
    filter: '{ "name": "Batman", "company": "40" }',
    populate: '{ "measureUnit": {"project":{"id":1, "name":1}}, "tax": {"project":{"id":1, "name":1}} }',
    group: '["company"]',
    sort: '{ "name": -1, "company": 1 }',
  };
  const expected: Query<Item> = {
    project: { id: 1, name: 1 },
    filter: { name: 'Batman', company: '40' },
    populate: {
      measureUnit: { project: { id: 1, name: 1 } },
      tax: { project: { id: 1, name: 1 } },
    },
    group: ['company'],
    sort: { name: -1, company: 1 },
  };
  const result = parseQuery(qms);
  expect(result).toEqual(expected);
});

it('parseQuery limit', () => {
  const qm: QueryStringified = {
    skip: '200',
    limit: '100',
  };
  const expected: Query<Item> = {
    skip: 200,
    limit: 100,
  };
  const result = parseQuery(qm);
  expect(result).toEqual(expected);
});
