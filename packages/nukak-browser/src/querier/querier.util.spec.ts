import type { Query } from 'nukak/type';
import { Item, User } from 'nukak/test';
import { stringifyQuery, stringifyQueryParameter } from './querier.util.js';

it('stringifyQuery -- empty', () => {
  const source: Query<User> = {};
  const result = stringifyQuery(source);
  const expected = '';
  expect(result).toBe(expected);
});

it('stringifyQueryParameter', () => {
  expect(stringifyQueryParameter('project', undefined)).toBe('project=undefined');
  expect(stringifyQueryParameter('limit', 10, true)).toBe('?limit=10');
  expect(stringifyQueryParameter('limit', 10)).toBe('limit=10');
  expect(stringifyQueryParameter('limit', null, true)).toBe('?limit=null');
  expect(stringifyQueryParameter('sort', { createdAt: -1 })).toBe('sort={"createdAt":-1}');
});

it('stringifyQuery', () => {
  expect(stringifyQuery(undefined)).toBe('');
  expect(stringifyQuery({})).toBe('');
  expect(stringifyQuery({ $sort: undefined })).toBe('');
  const source: Query<Item> = {
    $project: { id: 1, name: 1, tax: true, measureUnit: { $project: { id: 1, name: 1, categoryId: 1 } } },
    $filter: { name: 'Batman', companyId: 38 },
    $group: ['companyId'],
    $sort: { companyId: 1, name: -1 },
    $limit: 5,
  };
  const result = stringifyQuery(source);
  const expected =
    '?$project={"id":1,"name":1,"tax":true,"measureUnit":{"$project":{"id":1,"name":1,"categoryId":1}}}&$filter={"name":"Batman","companyId":38}&$group=["companyId"]&$sort={"companyId":1,"name":-1}&$limit=5';
  expect(result).toBe(expected);
});
