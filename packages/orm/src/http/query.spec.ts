import { describe, expect, it } from 'vitest';
import type { Item, User } from '../test/index.js';
import type { Query, QueryStringified } from '../type/index.js';
import { parseQueryParams, stringifyQuery } from './query.js';

describe('parseQueryParams rejections', () => {
  /** A row lock outlives the request that asked for it over HTTP, so it is refused rather than dropped. */
  it('should refuse a $lock', () => {
    expect(() => parseQueryParams({ $lock: 'true' })).toThrow("'$lock' is not supported over HTTP");
  });
});

describe('parseQueryParams', () => {
  it('should parse an empty query string', () => {
    expect(parseQueryParams()).toEqual({ $where: {} });
    expect(parseQueryParams({})).toEqual({ $where: {} });
  });

  it('should parse stringified params', () => {
    const queryStr = {
      $select: '{ "id": true, "name": true }',
      $populate: '{ "measureUnit": true, "tax": true }',
      $exclude: '{ "createdAt": true }',
      $where: '{ "name": "lorem", "companyId": "40" }',
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
      $where: { name: 'lorem', companyId: '40' },
      $sort: { name: -1, companyId: 1 },
      $skip: 200,
      $limit: 100,
    } satisfies Query<Item>;
    expect(parseQueryParams(queryStr)).toEqual(query);
  });

  it('should keep params already parsed', () => {
    const query = {
      $select: { id: true, name: true },
      $where: { name: 'lorem' },
      $sort: { name: -1 },
      $skip: 50,
      $limit: 10,
    } satisfies Query<Item>;
    expect(parseQueryParams(query)).toEqual(query);
  });

  it('should do not mutate the input', () => {
    const params = { $where: '{"name":"lorem"}' };
    parseQueryParams(params);
    expect(params.$where).toBe('{"name":"lorem"}');
  });

  describe('prototype pollution defense', () => {
    it('should reject __proto__ pollution via $where', () => {
      const query = parseQueryParams({ $where: '{"__proto__": {"polluted": true}}' });
      expect({}).not.toHaveProperty('polluted');
      // __proto__ stays an own entry of the parsed object instead of poisoning the prototype
      expect(Object.entries(query.$where ?? {})).toContainEqual(['__proto__', { polluted: true }]);
    });

    it('should reject __proto__ pollution via $select', () => {
      parseQueryParams({ $select: '{"__proto__": {"polluted2": true}}' });
      expect({}).not.toHaveProperty('polluted2');
    });

    it('should reject __proto__ pollution via $exclude', () => {
      parseQueryParams({ $exclude: '{"__proto__": {"polluted3": true}}' });
      expect({}).not.toHaveProperty('polluted3');
    });

    it('should reject constructor.prototype pollution via $populate', () => {
      parseQueryParams({ $populate: '{"constructor": {"prototype": {"polluted4": true}}}' });
      expect({}).not.toHaveProperty('polluted4');
    });
  });

  describe('number coercion defense', () => {
    it('should coerce valid numeric strings for $skip', () => {
      expect(parseQueryParams({ $skip: '42' }).$skip).toBe(42);
    });

    it('should coerce NaN for non-numeric $skip', () => {
      expect(parseQueryParams({ $skip: 'abc' }).$skip).toBeNaN();
    });

    it('should coerce valid numeric strings for $limit', () => {
      expect(parseQueryParams({ $limit: '100' }).$limit).toBe(100);
    });

    it('should coerce NaN for non-numeric $limit', () => {
      expect(parseQueryParams({ $limit: 'DROP TABLE' }).$limit).toBeNaN();
    });

    // `$candidates` is spelled into a `SET`, not bound, so the wire has to hand the dialect a number
    // for its own check to mean anything. Unlike `$lock`, it is allowed over HTTP.
    it('should coerce valid numeric strings for $candidates', () => {
      expect(parseQueryParams({ $candidates: '200' }).$candidates).toBe(200);
    });

    it('should coerce NaN for non-numeric $candidates', () => {
      expect(parseQueryParams({ $candidates: '1; DROP TABLE users' }).$candidates).toBeNaN();
    });
  });

  describe('boolean coercion defense', () => {
    it('should honor $distinct from the wire', () => {
      expect(parseQueryParams({ $distinct: 'true' })).toEqual({ $where: {}, $distinct: true });
      expect(parseQueryParams({ $distinct: true })).toEqual({ $where: {}, $distinct: true });
    });

    it("should read 'false' as false, not as a non-empty string", () => {
      expect(parseQueryParams({ $distinct: 'false' })).toEqual({ $where: {}, $distinct: false });
    });
  });

  it('should throw a 400-status error on malformed JSON', () => {
    expect(() => parseQueryParams({ $where: '{bad' })).toThrow(
      expect.objectContaining({ message: "invalid JSON in '$where'", status: 400 }),
    );
  });

  it('should throw a 400-status error on a $where that is not a map', () => {
    expect(() => parseQueryParams({ $where: '[1, 2]' })).toThrow(
      expect.objectContaining({ message: "'$where' must be a JSON object", status: 400 }),
    );
    expect(() => parseQueryParams({ $where: '5' })).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('should drop unknown query keys (allowlist) so clients cannot inject filters/context', () => {
    const query = parseQueryParams({ $customKey: 'value', filters: 'false', context: '{}' });
    expect(query).not.toHaveProperty('$customKey');
    expect(query).not.toHaveProperty('filters');
    expect(query).not.toHaveProperty('context');
  });
});

describe('stringifyQuery', () => {
  it('should stringify an empty query', () => {
    expect(stringifyQuery(undefined)).toBe('');
    expect(stringifyQuery({})).toBe('');
    expect(stringifyQuery({ $sort: undefined })).toBe('');
    const source: Query<User> = {};
    expect(stringifyQuery(source)).toBe('');
  });

  it('should serialize objects as JSON and scalars as-is, percent-encoded', () => {
    const source: Query<Item> = {
      $select: { id: 1, name: 1 },
      $populate: { tax: true, measureUnit: { $select: { id: 1, name: 1, categoryId: 1 } } },
      $where: { name: 'Batman', companyId: '38' },
      $sort: { companyId: 1, name: -1 },
      $limit: 5,
    };
    const result = stringifyQuery(source);
    const entries = Object.fromEntries(new URLSearchParams(result.slice(1)));
    expect(entries).toEqual({
      $select: '{"id":1,"name":1}',
      $populate: '{"tax":true,"measureUnit":{"$select":{"id":1,"name":1,"categoryId":1}}}',
      $where: '{"name":"Batman","companyId":"38"}',
      $sort: '{"companyId":1,"name":-1}',
      $limit: '5',
    });
  });

  it('should stringify null and numbers like the raw values', () => {
    expect(stringifyQuery({ $limit: 10 })).toBe('?%24limit=10');
    expect(stringifyQuery({ key: null })).toBe('?key=null');
  });

  it('should encode values containing querystring delimiters', () => {
    const source = { $where: { name: 'a&b=c?d' } };
    const qs = stringifyQuery(source);
    const entries = Object.fromEntries(new URLSearchParams(qs.slice(1)));
    expect(entries['$where']).toBe('{"name":"a&b=c?d"}');
  });
});

describe('round trip', () => {
  const roundTrip = (source: Record<string, unknown>) =>
    parseQueryParams(Object.fromEntries(new URLSearchParams(stringifyQuery(source).slice(1))));

  it('should preserve a query through parse(stringify(q))', () => {
    const source = {
      $select: { id: true, name: true },
      $where: { name: 'lorem ipsum', companyId: '40' },
      $sort: { name: -1 },
      $skip: 200,
      $limit: 100,
    } satisfies Query<Item>;
    expect(roundTrip(source)).toEqual(source);
  });

  it('should survive special characters in values', () => {
    const source = { $where: { name: 'a&b=c?d+e "quoted"' } };
    expect(roundTrip(source)).toEqual(source);
  });

  it('should default $where when absent', () => {
    expect(roundTrip({ $limit: 5 })).toEqual({ $limit: 5, $where: {} });
  });
});
