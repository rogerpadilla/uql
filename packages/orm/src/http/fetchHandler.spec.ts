import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { createMockQuerier, createMockQuerierPool, type MockedQuerier, User } from '../test/index.js';
import type { QuerierPool } from '../type/index.js';
import { createFetchHandler } from './fetchHandler.js';

describe('createFetchHandler', () => {
  let mockQuerier: MockedQuerier;
  let pool: QuerierPool;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuerier = createMockQuerier();
    pool = createMockQuerierPool(new PostgresDialect(), async () => mockQuerier);
  });

  it('should serve GET /user/one', async () => {
    mockQuerier.findOne.mockResolvedValue({ id: 1, name: 'John' });
    const handler = createFetchHandler({ pool, include: [User] });
    const where = encodeURIComponent(JSON.stringify({ name: 'John' }));
    const resp = await handler(new Request(`http://localhost/user/one?$where=${where}`));
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ data: { id: 1, name: 'John' }, count: 1 });
    expect(mockQuerier.findOne).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { name: 'John' } }));
  });

  it('should strip the basePath prefix', async () => {
    mockQuerier.findMany.mockResolvedValue([{ id: 1 }]);
    const handler = createFetchHandler({ pool, include: [User], basePath: '/api' });
    const resp = await handler(new Request('http://localhost/api/user'));
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ data: [{ id: 1 }] });
  });

  it('should parse JSON query parameters from the URL', async () => {
    mockQuerier.findMany.mockResolvedValue([]);
    const handler = createFetchHandler({ pool, include: [User] });
    const where = encodeURIComponent('{"name":"John"}');
    await handler(new Request(`http://localhost/user?$where=${where}&$limit=5`));
    expect(mockQuerier.findMany).toHaveBeenCalledWith(
      User,
      expect.objectContaining({ $where: { name: 'John' }, $limit: 5 }),
    );
  });

  it('should parse the JSON body of POST /user and run it in a transaction', async () => {
    mockQuerier.insertOne.mockResolvedValue(1);
    const handler = createFetchHandler({ pool, include: [User] });
    const resp = await handler(
      new Request('http://localhost/user', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'John' }),
      }),
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ data: 1, count: 1 });
    expect(mockQuerier.insertOne).toHaveBeenCalledWith(User, { name: 'John' });
    expect(mockQuerier.commitTransaction).toHaveBeenCalled();
  });

  it('should read with the JSON query in the body of a QUERY (RFC 10008)', async () => {
    mockQuerier.findOne.mockResolvedValue({ id: 1 });
    const handler = createFetchHandler({ pool, include: [User] });
    const resp = await handler(
      new Request('http://localhost/user/one', {
        method: 'QUERY',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ $where: { name: 'John' } }),
      }),
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ data: { id: 1 }, count: 1 });
    expect(mockQuerier.findOne).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { name: 'John' } }));
  });

  it('should answer 400 to a QUERY whose body is not an object', async () => {
    const handler = createFetchHandler({ pool, include: [User] });
    const resp = await handler(new Request('http://localhost/user', { method: 'QUERY', body: '[1]' }));
    expect(resp.status).toBe(400);
    expect(await resp.json()).toEqual({ error: { message: 'the query must be a JSON object', code: 400 } });
    expect(mockQuerier.findMany).not.toHaveBeenCalled();
  });

  it('should strip the basePath only at a path boundary', async () => {
    const handler = createFetchHandler({ pool, include: [User], basePath: '/api' });
    const resp = await handler(new Request('http://localhost/apiuser'));
    expect(resp.status).toBe(404);
    expect(mockQuerier.findMany).not.toHaveBeenCalled();
  });

  it('should tolerate an empty request body', async () => {
    mockQuerier.findMany.mockResolvedValue([]);
    const handler = createFetchHandler({ pool, include: [User] });
    const resp = await handler(new Request('http://localhost/user', { method: 'QUERY' }));
    expect(resp.status).toBe(200);
    expect(mockQuerier.findMany).toHaveBeenCalledWith(User, expect.objectContaining({ $where: {} }));
  });

  it('should answer 400 to a malformed JSON body', async () => {
    const handler = createFetchHandler({ pool, include: [User] });
    const resp = await handler(new Request('http://localhost/user', { method: 'POST', body: '{bad' }));
    expect(resp.status).toBe(400);
    expect(await resp.json()).toEqual({ error: { message: 'invalid JSON body', code: 400 } });
    expect(mockQuerier.insertOne).not.toHaveBeenCalled();
  });

  it('should answer 400 to a malformed JSON query parameter', async () => {
    const handler = createFetchHandler({ pool, include: [User] });
    const resp = await handler(new Request('http://localhost/user?$where={bad'));
    expect(resp.status).toBe(400);
    expect(await resp.json()).toEqual({ error: { message: "invalid JSON in '$where'", code: 400 } });
  });

  it('should answer 404 to an unknown entity or route', async () => {
    const handler = createFetchHandler({ pool, include: [User] });
    const unknownEntity = await handler(new Request('http://localhost/other'));
    expect(unknownEntity.status).toBe(404);
    expect(await unknownEntity.json()).toEqual({ error: { message: 'not found', code: 404 } });
    const tooDeep = await handler(new Request('http://localhost/user/1/extra'));
    expect(tooDeep.status).toBe(404);
    const emptyPath = await handler(new Request('http://localhost/'));
    expect(emptyPath.status).toBe(404);
  });

  it('should map errors to the canonical envelope', async () => {
    mockQuerier.findOne.mockRejectedValue(new Error('One error'));
    const handler = createFetchHandler({ pool, include: [User] });
    const resp = await handler(new Request('http://localhost/user/one'));
    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({ error: { message: 'One error', code: 500 } });
  });

  it('should honor a numeric status thrown by a hook', async () => {
    const handler = createFetchHandler({
      pool,
      include: [User],
      pre: () => {
        throw Object.assign(new Error('forbidden'), { status: 403 });
      },
    });
    const resp = await handler(new Request('http://localhost/user'));
    expect(resp.status).toBe(403);
    expect(await resp.json()).toEqual({ error: { message: 'forbidden', code: 403 } });
  });

  it('should expose the web Request to hooks as context', async () => {
    mockQuerier.findMany.mockResolvedValue([]);
    const handler = createFetchHandler({
      pool,
      include: [User],
      preFilter: ({ query, context }) => {
        query.$where ??= {};
        Object.assign(query.$where as object, { companyId: context.headers.get('x-company-id') });
      },
    });
    await handler(new Request('http://localhost/user', { headers: { 'x-company-id': '40' } }));
    expect(mockQuerier.findMany).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { companyId: '40' } }));
  });
});
