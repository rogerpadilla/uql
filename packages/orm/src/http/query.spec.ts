import { describe, expect, it } from 'vitest';
import type { Item, User } from '../test/index.js';
import type { Query } from '../type/index.js';
import { raw } from '../util/index.js';
import { parseQueryParams, stringifyQuery, wireJson } from './query.js';

const RAW_REFUSED = 'raw SQL cannot travel over HTTP: what leaves the browser is JSON';
const BINARY_REFUSED = 'binary cannot travel over HTTP: what leaves the browser is JSON';

describe('wireJson', () => {
  /** JSON keeps none of a `raw` fragment, so it would arrive as `{}` and be built into a statement. */
  it('should refuse a raw fragment wherever it sits', () => {
    expect(() => wireJson({ $where: { name: raw`lower(name)` } })).toThrow(RAW_REFUSED);
    expect(() => wireJson({ $select: [raw`LOG10(price)`] })).toThrow(RAW_REFUSED);
    expect(() => wireJson({ $where: { name: { $not: raw`lower(name)` } } })).toThrow(RAW_REFUSED);
  });

  /** JSON writes a blob as an object keyed by index, which no column reads: `{"0":1,"1":2}`. */
  it('should refuse binary, in a filter and in a write payload alike', () => {
    expect(() => wireJson({ $where: { thumb: new Uint8Array([1, 2]) } })).toThrow(BINARY_REFUSED);
    expect(() => wireJson({ bytes: new Uint8Array([1, 2]) })).toThrow(BINARY_REFUSED);
    expect(() => wireJson({ bytes: new Uint8Array([1, 2]).buffer })).toThrow(BINARY_REFUSED);
  });

  /** ISO 8601 is what a date column reads, so a `Date` travels rather than being refused. */
  it('should write a date as ISO 8601', () => {
    expect(wireJson({ $where: { createdAt: new Date(0) } })).toBe(
      '{"$where":{"createdAt":"1970-01-01T00:00:00.000Z"}}',
    );
  });

  it('should write the JSON a query travels as', () => {
    expect(wireJson({ $where: { name: 'lorem' } })).toBe('{"$where":{"name":"lorem"}}');
  });
});

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
    } satisfies Record<string, string>;
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
  it('should refuse a raw fragment, as the body it mirrors does', () => {
    expect(() => stringifyQuery({ $where: { $exists: raw`SELECT 1` } })).toThrow(RAW_REFUSED);
  });

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
