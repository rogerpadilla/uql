import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { createMockQuerier, createMockQuerierPool, type MockedQuerier, User } from '../test/index.js';
import type { QuerierPool } from '../type/index.js';
import { errorHandler, querierMiddleware } from './querierMiddleware.js';

/**
 * The handler logic (operations, hooks, transactions, envelopes) is covered by
 * src/http/handler.spec.ts; this suite covers the express-specific wiring only.
 */
describe('querierMiddleware', () => {
  let app: express.Express;
  let mockQuerier: MockedQuerier;
  let pool: QuerierPool;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuerier = createMockQuerier();
    pool = createMockQuerierPool(new PostgresDialect(), async () => mockQuerier);

    app = express();
    app.use(express.json());
    app.set('query parser', 'extended');
    app.use('/api', querierMiddleware({ pool, include: [User] }));

    app.use(errorHandler);
  });

  it('should route a GET, parsing the query string', async () => {
    mockQuerier.findMany.mockResolvedValue([{ id: 1, name: 'John' }]);
    const res = await request(app).get('/api/user?$limit=5');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [{ id: 1, name: 'John' }] });
    expect(mockQuerier.findMany).toHaveBeenCalledWith(User, expect.objectContaining({ $limit: 5 }));
  });

  it('should tolerate a trailing slash', async () => {
    mockQuerier.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/user/');
    expect(res.status).toBe(200);
  });

  it('should route a POST with the parsed JSON body', async () => {
    mockQuerier.insertOne.mockResolvedValue(1);
    const res = await request(app).post('/api/user').send({ name: 'John' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: 1, count: 1 });
    expect(mockQuerier.insertOne).toHaveBeenCalledWith(User, { name: 'John' });
    expect(mockQuerier.commitTransaction).toHaveBeenCalled();
  });

  it('should route a PUT to saveOne', async () => {
    mockQuerier.saveOne.mockResolvedValue(1);
    const res = await request(app).put('/api/user').send({ id: 1, name: 'John' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: 1, count: 1 });
  });

  it('should route a PATCH with the id sub-path', async () => {
    mockQuerier.updateMany.mockResolvedValue(1);
    const res = await request(app).patch('/api/user/1').send({ name: 'John' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: '1', count: 1 });
    expect(mockQuerier.updateMany).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { id: '1' } }), {
      name: 'John',
    });
  });

  it('should route a DELETE with the id sub-path', async () => {
    mockQuerier.deleteMany.mockResolvedValue(1);
    const res = await request(app).delete('/api/user/1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: '1', count: 1 });
  });

  it('should read bracket params as a $where map ($where[name]=John) with the extended parser', async () => {
    mockQuerier.findOne.mockResolvedValue({ id: 123 });
    const res = await request(app).get('/api/user/123?$where[name]=John');
    expect(res.status).toBe(200);
    expect(mockQuerier.findOne).toHaveBeenCalledWith(
      User,
      expect.objectContaining({ $where: { name: 'John', id: '123' } }),
    );
  });

  it('should not read a bracket list as a $where ($where[]=1)', async () => {
    const res = await request(app).get('/api/user/123?$where[]=1');
    expect(res.status).toBe(400);
    expect(mockQuerier.findOne).not.toHaveBeenCalled();
  });

  it('should read with the query in the body of a QUERY /api/user (RFC 10008)', async () => {
    mockQuerier.findMany.mockResolvedValue([{ id: 1 }]);
    const server = app.listen(0);
    try {
      const { port } = server.address() as { port: number };
      const res = await fetch(`http://localhost:${port}/api/user`, {
        method: 'QUERY',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ $where: { name: 'John' }, $limit: 5 }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: [{ id: 1 }] });
      expect(mockQuerier.findMany).toHaveBeenCalledWith(
        User,
        expect.objectContaining({ $where: { name: 'John' }, $limit: 5 }),
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('should fall through to 404 for an unknown method', async () => {
    const res = await request(app).options('/api/user/1');
    expect(res.status).toBe(404);
    expect(mockQuerier.findMany).not.toHaveBeenCalled();
  });

  it('should fall through to 404 for an unknown or excluded entity', async () => {
    class OtherEntity {}
    const router = querierMiddleware({ pool, include: [User, OtherEntity], exclude: [OtherEntity] });
    app = express();
    app.use('/api', router);
    const res = await request(app).get('/api/other-entity');
    expect(res.status).toBe(404);
  });

  it('should map a non-Error exception to a generic 500', async () => {
    mockQuerier.findOne.mockRejectedValue('raw string error');
    const res = await request(app).get('/api/user/one');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { message: 'Internal Server Error', code: 500 } });
  });

  it('should honor a numeric error status', async () => {
    mockQuerier.findOne.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    const res = await request(app).get('/api/user/one');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { message: 'forbidden', code: 403 } });
  });

  it('should throw if no entities are provided', () => {
    expect(() => querierMiddleware({ pool, include: [] })).toThrow('no entities for the uql middleware');
  });

  it('should use getEntities when include is omitted', () => {
    expect(querierMiddleware({ pool })).toBeDefined();
  });

  it('should hand hooks the express request as context', async () => {
    mockQuerier.findMany.mockResolvedValue([]);
    app = express();
    app.use(express.json());
    app.use(
      '/api',
      querierMiddleware({
        pool,
        include: [User],
        preFilter: ({ query, context }) => {
          query.$where ??= {};
          Object.assign(query.$where as object, { companyId: context.get('x-company-id') });
        },
      }),
    );
    const res = await request(app).get('/api/user').set('x-company-id', '40');
    expect(res.status).toBe(200);
    expect(mockQuerier.findMany).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { companyId: '40' } }));
  });
});
