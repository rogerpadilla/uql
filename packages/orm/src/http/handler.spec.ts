import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { createMockQuerier, createMockQuerierPool, type MockedQuerier, User } from '../test/index.js';
import type { QuerierPool } from '../type/index.js';
import { UqlRequestError } from '../util/uqlError.js';
import { type ApiOptions, createApi } from './api.js';
import type { ApiMiddleware } from './apiCall.js';
import { toFetchHandler, toRequestHandler } from './handler.js';

const BASE = 'http://localhost/api/v1';
const JSON_TYPE = { 'content-type': 'application/json' };

const fetchHandler = (opts: ApiOptions<Request>) => toFetchHandler(createApi(opts));

function get(path: string, call?: object, headers?: Record<string, string>): Request {
  return new Request(`${BASE}${path}${call ? `?q=${encodeURIComponent(JSON.stringify(call))}` : ''}`, { headers });
}

function post(path: string, body: string, headers: Record<string, string> = JSON_TYPE, method = 'POST'): Request {
  return new Request(`${BASE}${path}`, { method, headers, body });
}

describe('toFetchHandler', () => {
  let mockQuerier: MockedQuerier;
  let pool: QuerierPool;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuerier = createMockQuerier();
    pool = createMockQuerierPool(new PostgresDialect(), async () => mockQuerier);
  });

  it('should read with the call in q, under any base', async () => {
    mockQuerier.findOne.mockResolvedValue({ id: 1, name: 'John' });
    const handler = fetchHandler({ pool, include: [User] });

    const resp = await handler(get('/user/findOne', { query: { $where: { name: 'John' } } }));

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ data: { id: 1, name: 'John' } });
    expect(mockQuerier.findOne).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { name: 'John' } }));
  });

  it.each(['QUERY', 'POST'])('should read with the call in the body of a %s', async (method) => {
    mockQuerier.findOne.mockResolvedValue({ id: 1 });
    const handler = fetchHandler({ pool, include: [User] });

    const resp = await handler(post('/user/findOneById', '{"id":1}', JSON_TYPE, method));

    expect(await resp.json()).toEqual({ data: { id: 1 } });
    expect(mockQuerier.findOne).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { id: 1 } }));
  });

  it('should write the payload a POST carries, in a transaction', async () => {
    mockQuerier.insertOne.mockResolvedValue(1);
    const handler = fetchHandler({ pool, include: [User] });

    const resp = await handler(post('/user/insertOne', '{"payload":{"name":"John"}}'));

    expect(await resp.json()).toEqual({ data: 1 });
    expect(mockQuerier.insertOne).toHaveBeenCalledWith(User, { name: 'John' });
    expect(mockQuerier.transaction).toHaveBeenCalled();
  });

  it('should take a POST with no body as a call carrying nothing', async () => {
    mockQuerier.count.mockResolvedValue(3);
    const handler = fetchHandler({ pool, include: [User] });

    const resp = await handler(post('/user/count', ''));

    expect(await resp.json()).toEqual({ data: 3 });
  });

  it('should take an entity path the client percent-encoded', async () => {
    mockQuerier.count.mockResolvedValue(0);
    const handler = fetchHandler({ pool, include: [User], entityPath: () => 'the user' });

    expect((await handler(get(`/${encodeURIComponent('the user')}/count`))).status).toBe(200);
  });

  it('should refuse a write sent as GET, naming the method it takes, and read no body', async () => {
    const handler = fetchHandler({ pool, include: [User] });

    const resp = await handler(get('/user/deleteMany', { query: { $where: { name: 'a' } } }));

    expect(resp.status).toBe(405);
    expect(resp.headers.get('allow')).toBe('POST');
    expect(await resp.json()).toEqual({
      error: { message: "'deleteMany' takes POST, not GET", status: 405, kind: 'usage' },
    });
    expect(mockQuerier.deleteMany).not.toHaveBeenCalled();
  });

  /** The content type is refused before the body is read, so a form's body never reaches a JSON parser. */
  it('should refuse a form body as 415, not as malformed JSON', async () => {
    const handler = fetchHandler({ pool, include: [User] });

    const resp = await handler(
      post('/user/insertOne', 'payload=1', { 'content-type': 'application/x-www-form-urlencoded' }),
    );

    expect(resp.status).toBe(415);
  });

  it('should refuse a body that is not JSON, which a cross-site form sends', async () => {
    const handler = fetchHandler({ pool, include: [User] });

    const resp = await handler(post('/user/insertOne', '{"payload":{}}', { 'content-type': 'text/plain' }));

    expect(resp.status).toBe(415);
    expect(mockQuerier.insertOne).not.toHaveBeenCalled();
  });

  it('should answer 400 to a body that is not valid JSON, pointing nowhere in the call', async () => {
    const handler = fetchHandler({ pool, include: [User] });

    const resp = await handler(post('/user/insertOne', '{bad'));

    expect(resp.status).toBe(400);
    expect(await resp.json()).toEqual({ error: { message: 'invalid JSON body', status: 400, kind: 'usage' } });
  });

  it('should answer 400 with where the call went wrong', async () => {
    const handler = fetchHandler({ pool, include: [User] });

    const resp = await handler(get('/user/findMany', { query: { $limit: '10' } }));

    expect(resp.status).toBe(400);
    expect(await resp.json()).toEqual({
      error: { message: "'$limit' must be a number", status: 400, kind: 'usage', path: ['query', '$limit'] },
    });
  });

  it.each(['/other/findMany', '/user/aggregate', '/user', '/'])('should answer 404 to %s', async (path) => {
    const resp = await fetchHandler({ pool, include: [User] })(get(path));

    expect(resp.status).toBe(404);
    expect(await resp.json()).toEqual({ error: { message: 'Not Found', status: 404, kind: 'usage' } });
  });

  it("should keep a driver's message off the wire", async () => {
    mockQuerier.findOne.mockRejectedValue(new Error('relation "secret" does not exist'));

    const resp = await fetchHandler({ pool, include: [User] })(get('/user/findOne'));

    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({ error: { message: 'Internal Server Error', status: 500 } });
  });

  /** An HTTP driver (libSQL's) raises its own errors with a `status`, and their message names tables. */
  it("should keep a driver's message off the wire when the error carries a status", async () => {
    mockQuerier.findOne.mockRejectedValue(Object.assign(new Error('no such table: secret'), { status: 400 }));

    const resp = await fetchHandler({ pool, include: [User] })(get('/user/findOne'));

    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({ error: { message: 'Internal Server Error', status: 500 } });
  });

  it('should answer a querier throwing no error at all as a 500', async () => {
    mockQuerier.findOne.mockRejectedValue('connection lost');

    const resp = await fetchHandler({ pool, include: [User] })(get('/user/findOne'));

    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({ error: { message: 'Internal Server Error', status: 500 } });
  });

  it("should answer a driver's constraint violation by its kind", async () => {
    mockQuerier.insertOne.mockRejectedValue(Object.assign(new Error('duplicate key "users_email"'), { code: '23505' }));

    const resp = await fetchHandler({ pool, include: [User] })(post('/user/insertOne', '{"payload":{}}'));

    expect(resp.status).toBe(409);
    expect(await resp.json()).toEqual({ error: { message: 'Conflict', status: 409, kind: 'uniqueViolation' } });
  });

  it('should answer a body that fails while it is read with the envelope', async () => {
    const failing = new ReadableStream({
      start: (controller) => controller.error(new Error('connection reset')),
    });
    const request = new Request(`${BASE}/user/insertOne`, {
      method: 'POST',
      headers: JSON_TYPE,
      body: failing,
      duplex: 'half',
    });

    const resp = await fetchHandler({ pool, include: [User] })(request);

    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({ error: { message: 'Internal Server Error', status: 500 } });
  });

  it('should answer a path segment that does not decode as a route nothing serves', async () => {
    const resp = await fetchHandler({ pool, include: [User] })(get('/%E0%A4/findMany'));

    expect(resp.status).toBe(404);
    expect(await resp.json()).toEqual({ error: { message: 'Not Found', status: 404, kind: 'usage' } });
  });

  it("should answer a middleware's refusal with its status", async () => {
    const refuse: ApiMiddleware<Request> = () => {
      throw new UqlRequestError('forbidden', 403);
    };

    const resp = await fetchHandler({ pool, include: [User], use: [refuse] })(get('/user/findMany'));

    expect(resp.status).toBe(403);
    expect(await resp.json()).toEqual({ error: { message: 'forbidden', status: 403, kind: 'usage' } });
  });

  it('should hand middleware the web Request as context', async () => {
    mockQuerier.findMany.mockResolvedValue([]);
    const scope: ApiMiddleware<Request> = (call, request, next) =>
      next({
        ...call,
        query: {
          ...call.query,
          $where: Object.assign({}, call.query.$where, { companyId: request.headers.get('x-company-id') }),
        },
      });
    const handler = fetchHandler({ pool, include: [User], use: [scope] });

    await handler(get('/user/findMany', undefined, { 'x-company-id': '40' }));

    expect(mockQuerier.findMany).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { companyId: '40' } }));
  });
});

describe('toRequestHandler', () => {
  const pool = createMockQuerierPool(new PostgresDialect(), async () => createMockQuerier());
  const handle = toRequestHandler(createApi({ pool, include: [User] }));

  it('should answer undefined for an entity or an op it does not serve, for the adapter to fall through', async () => {
    expect(await handle({ method: 'GET', entityPath: 'other', op: 'findMany', context: undefined })).toBeUndefined();
    expect(await handle({ method: 'GET', entityPath: 'user', op: 'aggregate', context: undefined })).toBeUndefined();
  });

  it('should answer a failure as its status and envelope rather than rejecting', async () => {
    await expect(
      handle({ method: 'GET', entityPath: 'user', op: 'findManyPage', context: undefined }),
    ).resolves.toEqual({
      status: 400,
      body: {
        error: {
          message: "a page of 'User' holds a positive whole number of rows, and $limit is undefined",
          status: 400,
          kind: 'usage',
          path: ['query', '$limit'],
        },
      },
    });
  });
});
