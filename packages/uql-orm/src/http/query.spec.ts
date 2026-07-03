import { describe, expect, it } from 'vitest';
import type { Item, User } from '../test/index.js';
import type { Query, QueryStringified } from '../type/index.js';
import { parseQueryParams, stringifyQuery } from './query.js';

describe('parseQueryParams', () => {
  it('empty', () => {
    expect(parseQueryParams()).toEqual({ $where: {} });
    expect(parseQueryParams({})).toEqual({ $where: {} });
  });

  it('stringified', () => {
    const queryStr = {
      $select: '{ "id": true, "name": true }',
      $populate: '{ "measureUnit": true, "tax": true }',
      $exclude: '{ "createdAt": true }',
      $where: '{ "name": "lorem", "companyId": 40 }',
      $sort: '{ "name": -1, "companyId": 1 }',
      $skip: '200',
      $limit: '100',
    } satisfies QueryStringified;
    const query = {
      $select: {
        id: true,
        name: true,
      },
      $populate: {
        measureUnit: true,
        tax: true,
      },
      $exclude: { createdAt: true },
      $where: { name: 'lorem', companyId: 40 },
      $sort: { name: -1, companyId: 1 },
      $skip: 200,
      $limit: 100,
    } satisfies Query<Item>;
    expect(parseQueryParams(queryStr)).toEqual(query);
  });

  it('already parsed', () => {
    const query = {
      $select: { id: true, name: true },
      $where: { name: 'lorem' },
      $sort: { name: -1 },
      $skip: 50,
      $limit: 10,
    } satisfies Query<Item>;
    expect(parseQueryParams(query)).toEqual(query);
  });

  it('does not mutate the input', () => {
    const params = { $where: '{"name":"lorem"}' };
    parseQueryParams(params);
    expect(params.$where).toBe('{"name":"lorem"}');
  });

  describe('prototype pollution defense', () => {
    it('rejects __proto__ pollution via $where', () => {
      const query = parseQueryParams({ $where: '{"__proto__": {"polluted": true}}' });
      expect({} as Record<string, unknown>).not.toHaveProperty('polluted');
      // __proto__ stays an own entry of the parsed object instead of poisoning the prototype
      expect(Object.entries(query.$where as Record<string, unknown>)).toContainEqual(['__proto__', { polluted: true }]);
    });

    it('rejects __proto__ pollution via $select', () => {
      parseQueryParams({ $select: '{"__proto__": {"polluted2": true}}' });
      expect({} as Record<string, unknown>).not.toHaveProperty('polluted2');
    });

    it('rejects __proto__ pollution via $exclude', () => {
      parseQueryParams({ $exclude: '{"__proto__": {"polluted3": true}}' });
      expect({} as Record<string, unknown>).not.toHaveProperty('polluted3');
    });

    it('rejects constructor.prototype pollution via $populate', () => {
      parseQueryParams({ $populate: '{"constructor": {"prototype": {"polluted4": true}}}' });
      expect({} as Record<string, unknown>).not.toHaveProperty('polluted4');
    });
  });

  describe('number coercion defense', () => {
    it('coerces valid numeric strings for $skip', () => {
      expect(parseQueryParams({ $skip: '42' }).$skip).toBe(42);
    });

    it('coerces NaN for non-numeric $skip', () => {
      expect(parseQueryParams({ $skip: 'abc' }).$skip).toBeNaN();
    });

    it('coerces valid numeric strings for $limit', () => {
      expect(parseQueryParams({ $limit: '100' }).$limit).toBe(100);
    });

    it('coerces NaN for non-numeric $limit', () => {
      expect(parseQueryParams({ $limit: 'DROP TABLE' }).$limit).toBeNaN();
    });
  });

  it('throws a 400-status error on malformed JSON', () => {
    expect(() => parseQueryParams({ $where: '{bad' })).toThrow(
      expect.objectContaining({ message: "invalid JSON in '$where'", status: 400 }),
    );
  });

  it('preserves unknown query keys', () => {
    const query = parseQueryParams({ $customKey: 'value' }) as Record<string, unknown>;
    expect(query['$customKey']).toBe('value');
  });
});

describe('stringifyQuery', () => {
  it('empty', () => {
    expect(stringifyQuery(undefined)).toBe('');
    expect(stringifyQuery({})).toBe('');
    expect(stringifyQuery({ $sort: undefined })).toBe('');
    const source: Query<User> = {};
    expect(stringifyQuery(source)).toBe('');
  });

  it('serializes objects as JSON and scalars as-is, percent-encoded', () => {
    const source: Query<Item> = {
      $select: { id: 1, name: 1 },
      $populate: { tax: true, measureUnit: { $select: { id: 1, name: 1, categoryId: 1 } } },
      $where: { name: 'Batman', companyId: 38 },
      $sort: { companyId: 1, name: -1 },
      $limit: 5,
    };
    const result = stringifyQuery(source);
    const entries = Object.fromEntries(new URLSearchParams(result.slice(1)));
    expect(entries).toEqual({
      $select: '{"id":1,"name":1}',
      $populate: '{"tax":true,"measureUnit":{"$select":{"id":1,"name":1,"categoryId":1}}}',
      $where: '{"name":"Batman","companyId":38}',
      $sort: '{"companyId":1,"name":-1}',
      $limit: '5',
    });
  });

  it('stringifies null and numbers like the raw values', () => {
    expect(stringifyQuery({ $limit: 10 })).toBe('?%24limit=10');
    expect(stringifyQuery({ key: null })).toBe('?key=null');
  });

  it('encodes values containing querystring delimiters', () => {
    const source = { $where: { name: 'a&b=c?d' } };
    const qs = stringifyQuery(source);
    const entries = Object.fromEntries(new URLSearchParams(qs.slice(1)));
    expect(entries['$where']).toBe('{"name":"a&b=c?d"}');
  });
});

describe('round trip', () => {
  const roundTrip = (source: Record<string, unknown>) =>
    parseQueryParams(Object.fromEntries(new URLSearchParams(stringifyQuery(source).slice(1))));

  it('parse(stringify(q)) preserves the query', () => {
    const source = {
      $select: { id: true, name: true },
      $where: { name: 'lorem ipsum', companyId: 40 },
      $sort: { name: -1 },
      $skip: 200,
      $limit: 100,
    } satisfies Query<Item>;
    expect(roundTrip(source)).toEqual(source);
  });

  it('survives special characters in values', () => {
    const source = { $where: { name: 'a&b=c?d+e "quoted"' } };
    expect(roundTrip(source)).toEqual(source);
  });

  it('defaults $where when absent', () => {
    expect(roundTrip({ $limit: 5 })).toEqual({ $limit: 5, $where: {} });
  });
});
