import { describe, expect, it } from 'vitest';
import { sql } from '../util/index.js';
import { decodeRequest, encodeCall, type HttpCall, type HttpRequest, type ReadMethod } from './route.js';
import { isApiOp, type WireCall } from './wireCall.js';

/** What a server adapter reduces the request `encodeCall` spelled to: the last two path segments, `q` and the body's text. */
function received({ method, path, body }: HttpCall): HttpRequest {
  const { pathname, searchParams } = new URL(path, 'http://host');
  const [entityPath = '', op = ''] = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (!isApiOp(op)) {
    throw new Error(`no op: ${op}`);
  }
  return {
    method,
    entityPath,
    op,
    q: searchParams.get('q') ?? undefined,
    body,
    contentType: body === undefined ? undefined : 'application/json',
  };
}

const CALLS: WireCall[] = [
  { entity: 'user', op: 'findMany', query: { $where: { name: 'a' }, $limit: 2 } },
  { entity: 'user', op: 'findManyAndCount', query: { $skip: 5 } },
  { entity: 'user', op: 'findManyPage', query: { $limit: 2, $after: 'WyJhIl0' } },
  { entity: 'user', op: 'findOne', query: { $select: { name: true } } },
  { entity: 'user', op: 'count' },
  { entity: 'user-profile', op: 'findOneById', id: 'a/b?c', query: { $select: { name: true } } },
  { entity: 'user', op: 'insertOne', payload: { name: 'a' } },
  { entity: 'user', op: 'insertMany', payload: [{ name: 'a' }] },
  { entity: 'user', op: 'saveOne', payload: { id: 1, name: 'a' } },
  { entity: 'user', op: 'saveMany', payload: [{ id: 1 }] },
  { entity: 'user', op: 'updateMany', query: { $where: { name: 'a' } }, payload: { name: 'b' } },
  { entity: 'user', op: 'updateOneById', id: 1, payload: { name: 'b' } },
  { entity: 'user', op: 'deleteMany', query: { $where: { name: 'a' } }, hardDelete: true },
  { entity: 'user', op: 'deleteOneById', id: 1 },
];

describe('encodeCall and decodeRequest', () => {
  it.each(CALLS.flatMap((call) => (['GET', 'QUERY', 'POST'] as const).map((readMethod) => ({ call, readMethod }))))(
    'should read back $call.op sent with reads as $readMethod',
    ({ call, readMethod }) => {
      expect(decodeRequest(received(encodeCall(call, readMethod)))).toEqual(call);
    },
  );

  it.each<[ReadMethod, WireCall, HttpCall]>([
    [
      'GET',
      { entity: 'user', op: 'findMany', query: { $limit: 1 } },
      { method: 'GET', path: `/user/findMany?q=${encodeURIComponent('{"query":{"$limit":1}}')}` },
    ],
    ['GET', { entity: 'user', op: 'count' }, { method: 'GET', path: '/user/count' }],
    ['QUERY', { entity: 'user', op: 'count' }, { method: 'QUERY', path: '/user/count', body: '{}' }],
    [
      'GET',
      { entity: 'user', op: 'deleteOneById', id: 1 },
      { method: 'POST', path: '/user/deleteOneById', body: '{"id":1}' },
    ],
  ])('should spell a call with reads as %s', (readMethod, call, spelled) => {
    expect(encodeCall(call, readMethod)).toEqual(spelled);
  });

  it('should refuse raw SQL before it leaves', () => {
    expect(() => encodeCall({ entity: 'user', op: 'findMany', query: { $where: { name: sql`x` } } })).toThrow(
      'raw SQL cannot travel over the wire',
    );
  });
});

describe('decodeRequest', () => {
  const json = 'application/json; charset=utf-8';

  it('should refuse a method its op does not take, naming the ones it does', () => {
    expect(() => decodeRequest({ method: 'GET', entityPath: 'user', op: 'insertOne' })).toThrow(
      expect.objectContaining({ message: "'insertOne' takes POST, not GET", status: 405, headers: { allow: 'POST' } }),
    );
    expect(() => decodeRequest({ method: 'DELETE', entityPath: 'user', op: 'findMany' })).toThrow(
      expect.objectContaining({ status: 405, headers: { allow: 'GET, HEAD, QUERY, POST' } }),
    );
  });

  /** A cross-site form posts `text/plain` or form data with no preflight: refusing them leaves it nothing to send. */
  it.each([undefined, null, 'text/plain', 'application/x-www-form-urlencoded'])(
    'should refuse a body sent as %s',
    (contentType) => {
      expect(() =>
        decodeRequest({ method: 'POST', entityPath: 'user', op: 'insertOne', body: { payload: {} }, contentType }),
      ).toThrow(expect.objectContaining({ status: 415 }));
    },
  );

  it('should take a body a framework parsed already as the text it was', () => {
    const req = { method: 'POST', entityPath: 'user', op: 'insertOne', contentType: json } as const;

    expect(decodeRequest({ ...req, body: { payload: { name: 'a' } } })).toEqual(
      decodeRequest({ ...req, body: '{"payload":{"name":"a"}}' }),
    );
  });

  /** HEAD reads as GET does, the runtime leaving the body off: what a cache or a probe sends. */
  it('should read a HEAD as a GET', () => {
    expect(decodeRequest({ method: 'HEAD', entityPath: 'user', op: 'count', q: '{"query":{"$limit":1}}' })).toEqual({
      entity: 'user',
      op: 'count',
      query: { $limit: 1 },
    });
  });

  it('should take an empty body as a call carrying nothing', () => {
    expect(decodeRequest({ method: 'POST', entityPath: 'user', op: 'count', body: '', contentType: json })).toEqual({
      entity: 'user',
      op: 'count',
    });
  });

  /** The method and the content type are refused first, so what a form posts is never parsed. */
  it('should refuse a form body as 415 before reading it as JSON', () => {
    const form = { method: 'POST', entityPath: 'user', op: 'insertOne', body: 'payload=1' } as const;

    expect(() => decodeRequest({ ...form, contentType: 'application/x-www-form-urlencoded' })).toThrow(
      expect.objectContaining({ status: 415 }),
    );
    expect(() => decodeRequest({ ...form, contentType: json })).toThrow(
      expect.objectContaining({ message: 'invalid JSON body', status: 400 }),
    );
  });

  it('should take a POST with no body as a call carrying nothing', () => {
    expect(decodeRequest({ method: 'post', entityPath: 'user', op: 'count', contentType: json })).toEqual({
      entity: 'user',
      op: 'count',
    });
  });

  it.each([
    { what: 'a q that is no JSON', req: { method: 'GET', q: '{bad' }, refusal: "'q' is not valid JSON", path: ['q'] },
    {
      what: 'a q listed twice',
      req: { method: 'GET', q: ['{}', '{}'] },
      refusal: "'q' is the call as one JSON text",
      path: ['q'],
    },
    {
      what: 'a q that is no object',
      req: { method: 'GET', q: '[1]' },
      refusal: 'a call must be a JSON object',
      path: ['q'],
    },
    {
      what: 'a q beside a body',
      req: { method: 'POST', q: '{}', contentType: json },
      refusal: "a POST carries its call in the body, not in 'q'",
      path: ['q'],
    },
    {
      what: 'a body that is no object',
      req: { method: 'POST', body: [1], contentType: json },
      refusal: 'a call must be a JSON object',
      path: [],
    },
    {
      what: 'a body naming the op',
      req: { method: 'POST', body: { op: 'deleteMany' }, contentType: json },
      refusal: "a call's 'op' is named by its path",
      path: ['op'],
    },
    {
      what: 'a q naming the entity',
      req: { method: 'GET', q: '{"entity":"tenant"}' },
      refusal: "a call's 'entity' is named by its path",
      path: ['entity'],
    },
  ])('should refuse $what', ({ req, refusal, path }) => {
    expect(() => decodeRequest({ entityPath: 'user', op: 'findMany', ...req })).toThrow(
      expect.objectContaining({ message: refusal, status: 400, path }),
    );
  });
});
