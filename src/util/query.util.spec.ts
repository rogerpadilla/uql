import { Query, QueryStringified } from '../type';
import { Item, User } from '../entity/entityMock';
import { buildQuery, stringifyQuery, stringifyQueryParameter } from './query.util';

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

it('stringifyQueryParameter', () => {
  expect(stringifyQueryParameter('filter', undefined)).toBe('');
  expect(stringifyQueryParameter('limit', 10)).toBe('?limit=10');
  expect(stringifyQueryParameter('limit', 10, true)).toBe('limit=10');
  expect(stringifyQueryParameter('limit', null)).toBe('?limit=null');
  expect(stringifyQueryParameter('sort', { createdAt: -1 })).toBe('?sort={"createdAt":-1}');
});

it('stringifyQuery', () => {
  expect(stringifyQuery(undefined)).toBe('');
  expect(stringifyQuery({ filter: undefined })).toBe('');
  const source: Query<Item> = {
    project: { id: 1, name: 1 },
    populate: { tax: null, measureUnit: { project: { id: 1, name: 1, category: 1 } } },
    filter: { name: 'Batman', company: 38 },
    sort: { company: 1, name: -1 },
    skip: undefined,
    limit: 5,
  };
  const result = stringifyQuery(source);
  const expected =
    '?project={"id":1,"name":1}&populate={"tax":null,"measureUnit":{"project":{"id":1,"name":1,"category":1}}}&filter={"name":"Batman","company":38}&sort={"company":1,"name":-1}&limit=5';
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
    skip: 200,
    limit: 100,
  };
  const expected: Query<Item> = {
    skip: 200,
    limit: 100,
  };
  const result = buildQuery(qm);
  expect(result).toEqual(expected);
});
