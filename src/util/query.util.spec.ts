import { Query, QueryStringified, QueryFilter } from '../type';
import { Item, User } from '../entity/entityMock';
import { buildQuery, stringifyQuery } from './query.util';

it('stringifyQuery -- empty', () => {
  const source: Query<User> = {};
  const result = stringifyQuery(source);
  const expected = '';
  expect(result).toBe(expected);
});

it('buildQuery -- empty', () => {
  const res1 = buildQuery(undefined);
  expect(res1).toEqual({});
  const res2 = buildQuery({});
  expect(res2).toEqual({});
});

it('stringifyQuery', () => {
  const source: Query<Item> = {
    project: { id: 1, name: 1 },
    populate: { tax: null, measureUnit: { project: { id: 1, name: 1, category: 1 } } },
    filter: { name: 'Batman', company: 38 },
    sort: { company: 1, name: -1 },
    skip: 3,
    limit: 5,
  };
  const result = stringifyQuery(source);
  const expected =
    '?project={"id":1,"name":1}&populate={"tax":null,"measureUnit":{"project":{"id":1,"name":1,"category":1}}}&filter={"name":"Batman","company":38}&sort={"company":1,"name":-1}&skip=3&limit=5';
  expect(result).toBe(expected);
});

it('buildQuery stringified', () => {
  const qms: QueryStringified = {
    project: '{"id":1, "name":1}',
    filter: '{ "name": "Batman", "company": 40 }',
    populate: '{ "measureUnit": {"project":{"id":1, "name":1}}, "tax": {"project":{"id":1, "name":1}} }',
    sort: '{ "name": -1, "company": 1 }',
  };
  const expected: Query<Item> = {
    project: { id: 1, name: 1 },
    filter: { name: 'Batman', company: 40 },
    populate: { measureUnit: { project: { id: 1, name: 1 } }, tax: { project: { id: 1, name: 1 } } },
    sort: { name: -1, company: 1 },
  };
  const result = buildQuery(qms);
  expect(result).toEqual(expected);
});

it('buildQuery limit', () => {
  const qm: QueryStringified = {
    limit: 100,
  };
  const expected: Query<Item> = {
    limit: 100,
  };
  const result = buildQuery(qm);
  expect(result).toEqual(expected);
});
