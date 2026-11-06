import { describe, expect, it } from 'vitest';
import type { Item } from '../test/index.js';
import type { Query } from '../type/index.js';
import { parseWireQuery } from './wireQuery.js';

describe('parseWireQuery', () => {
  it('should take an empty query as one reading every row', () => {
    expect(parseWireQuery()).toEqual({ $where: {} });
    expect(parseWireQuery({})).toEqual({ $where: {} });
  });

  it('should take each clause the wire carries, as JSON carries it', () => {
    const query = {
      $select: { id: true, name: true },
      $populate: { measureUnit: true, tax: true },
      $where: { name: 'lorem', companyId: '40' },
      $sort: { name: -1, companyId: 1 },
      $skip: 200,
      $limit: 100,
      $distinct: false,
      $candidates: 50,
    } satisfies Query<Item>;
    expect(parseWireQuery(query)).toEqual(query);
  });

  it('should keep a cursor as the text a page handed out', () => {
    expect(parseWireQuery({ $after: 'WyJhIiwxXQ', $limit: 2 })).toEqual({
      $where: {},
      $after: 'WyJhIiwxXQ',
      $limit: 2,
    });
  });

  it('should not mutate the input', () => {
    const query = { $limit: 1 };
    parseWireQuery(query);
    expect(query).toEqual({ $limit: 1 });
  });

  /** Dropped, a misspelt clause would answer another read; a `$lock` outlives the request that asked for it. */
  it.each(['$lock', '$exclude', '$entity', 'filters', 'context', '__proto__'])(
    'should refuse %s, a key the wire query does not take',
    (key) => {
      expect(() => parseWireQuery(JSON.parse(`{"${key}": {}}`))).toThrow(
        expect.objectContaining({ message: `'${key}' is not a query key the wire takes`, path: ['query', key] }),
      );
    },
  );

  /** Text is no number: JSON carries one as itself, so a string here was sent to slip past the dialect's check. */
  it.each([
    ['$limit', '100', 'a number'],
    ['$skip', 'abc', 'a number'],
    ['$candidates', '1; DROP TABLE users', 'a number'],
    ['$distinct', 'false', 'a boolean'],
    ['$where', [1, 2], 'a JSON object'],
    ['$where', '{"name":"a"}', 'a JSON object'],
    ['$select', null, 'a JSON object'],
    ['$after', { $gt: 1 }, 'a cursor a page handed out'],
  ])('should refuse %s holding %j', (key, value, type) => {
    expect(() => parseWireQuery({ [key]: value })).toThrow(
      expect.objectContaining({ message: `'${key}' must be ${type}`, status: 400, path: ['query', key] }),
    );
  });

  it.each([[[1]], ['$where'], [5], [null]])('should refuse a query that is not a map: %j', (query) => {
    expect(() => parseWireQuery(query)).toThrow(
      expect.objectContaining({ message: 'the query must be a JSON object', status: 400, path: ['query'] }),
    );
  });
});
