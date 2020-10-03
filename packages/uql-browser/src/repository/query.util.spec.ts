import { Query } from 'uql/type';
import { Item, User } from 'uql/mock';
import { stringifyQuery, stringifyQueryParameter } from './query.util';

it('stringifyQuery -- empty', () => {
  const source: Query<User> = {};
  const result = stringifyQuery(source);
  const expected = '';
  expect(result).toBe(expected);
});

it('stringifyQueryParameter', () => {
  expect(stringifyQueryParameter('project', undefined)).toBe('?project=undefined');
  expect(stringifyQueryParameter('limit', 10)).toBe('?limit=10');
  expect(stringifyQueryParameter('limit', 10, true)).toBe('limit=10');
  expect(stringifyQueryParameter('limit', null)).toBe('?limit=null');
  expect(stringifyQueryParameter('sort', { createdAt: -1 })).toBe('?sort={"createdAt":-1}');
});

it('stringifyQuery', () => {
  expect(stringifyQuery(undefined)).toBe('');
  expect(stringifyQuery({ project: undefined })).toBe('?project=undefined');
  const source: Query<Item> = {
    project: { id: 1, name: 1 },
    populate: { tax: {}, measureUnit: { project: { id: 1, name: 1, category: 1 } } },
    filter: { name: 'Batman', company: '38' },
    group: ['company'],
    sort: { company: 1, name: -1 },
    limit: 5,
  };
  const result = stringifyQuery(source);
  const expected =
    '?project={"id":1,"name":1}&populate={"tax":{},"measureUnit":{"project":{"id":1,"name":1,"category":1}}}&filter={"name":"Batman","company":"38"}&group=["company"]&sort={"company":1,"name":-1}&limit=5';
  expect(result).toBe(expected);
});
