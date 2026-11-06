import { describe, expect, it } from 'vitest';
import { User } from '../test/index.js';
import { sql } from '../util/index.js';
import { UqlUsageError } from '../util/uqlError.js';
import { entityPath, isApiOp, parseWireCall, wireJson } from './wireCall.js';

const RAW_REFUSED = 'raw SQL cannot travel over the wire: what leaves the client is JSON';
const BINARY_REFUSED = 'binary cannot travel over the wire: what leaves the client is JSON';

describe('wireJson', () => {
  /** JSON keeps none of a `sql` fragment, so it would arrive as `{}` and be built into a statement. */
  it('should refuse a raw fragment wherever it sits', () => {
    expect(() => wireJson({ $where: { name: sql`lower(name)` } })).toThrow(RAW_REFUSED);
    expect(() => wireJson({ $select: [sql`LOG10(price)`] })).toThrow(RAW_REFUSED);
    expect(() => wireJson({ $where: { name: { $not: sql`lower(name)` } } })).toThrow(RAW_REFUSED);
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

describe('entityPath', () => {
  it('should kebab-case the entity name', () => {
    expect(entityPath(User)).toBe('user');
    class UserProfile {}
    expect(entityPath(UserProfile)).toBe('user-profile');
  });
});

describe('parseWireCall', () => {
  it('should take a call as JSON carries it', () => {
    const call = { entity: 'user', op: 'deleteOneById', id: 1, query: { $where: {} }, hardDelete: true };

    expect(parseWireCall(call)).toEqual(call);
  });

  /** What a transport that checks nothing (a tRPC procedure's input) hands over, from a client it cannot trust. */
  it.each([
    { what: 'no object', value: [1], refusal: 'a call must be a JSON object', path: [] },
    {
      what: 'a key no call has',
      value: { entity: 'user', op: 'findMany', filters: false },
      refusal: "'filters' is no part of a call",
      path: ['filters'],
    },
    {
      what: 'no entity',
      value: { op: 'findMany' },
      refusal: "a call names its entity's path in 'entity'",
      path: ['entity'],
    },
    {
      what: 'an op the API lacks',
      value: { entity: 'user', op: 'aggregate' },
      refusal: "'aggregate' is not an operation",
      path: ['op'],
    },
    {
      what: 'an object id',
      value: { entity: 'user', op: 'findOneById', id: {} },
      refusal: "a call's 'id' is a string or a number",
      path: ['id'],
    },
    {
      what: 'an id on an op naming none',
      value: { entity: 'user', op: 'findMany', id: 1 },
      refusal: "'findMany' addresses no row by 'id'",
      path: ['id'],
    },
    {
      what: 'a query list',
      value: { entity: 'user', op: 'findMany', query: [] },
      refusal: "a call's 'query' must be a JSON object",
      path: ['query'],
    },
    {
      what: 'a query on an insert',
      value: { entity: 'user', op: 'insertOne', query: {}, payload: {} },
      refusal: "'insertOne' takes no 'query'",
      path: ['query'],
    },
    {
      what: 'a payload on a read',
      value: { entity: 'user', op: 'findMany', payload: {} },
      refusal: "'findMany' writes no 'payload'",
      path: ['payload'],
    },
    {
      what: 'a hardDelete on a read',
      value: { entity: 'user', op: 'findMany', hardDelete: true },
      refusal: "'findMany' deletes nothing",
      path: ['hardDelete'],
    },
    {
      what: 'a textual hardDelete',
      value: { entity: 'user', op: 'deleteMany', hardDelete: 'true' },
      refusal: "a call's 'hardDelete' is a boolean",
      path: ['hardDelete'],
    },
  ])('should refuse $what, pointing at it', ({ value, refusal, path }) => {
    const refused = thrown(() => parseWireCall(value));
    expect(refused).toBeInstanceOf(UqlUsageError);
    expect(refused).toMatchObject({ message: expect.stringContaining(refusal), path });
  });
});

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('nothing was thrown');
}

describe('isApiOp', () => {
  it('should take the querier methods the API serves alone', () => {
    expect(isApiOp('findMany')).toBe(true);
    expect(isApiOp('findManyStream')).toBe(false);
    expect(isApiOp(1)).toBe(false);
  });
});
