import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../http/api.js';
import type { ApiMiddleware } from '../http/apiCall.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { createMockQuerier, createMockQuerierPool, type MockedQuerier, User } from '../test/index.js';
import type { QuerierPool } from '../type/index.js';
import { toExpress } from './router.js';

const q = (call: object) => `?q=${encodeURIComponent(JSON.stringify(call))}`;

/** The calls themselves are covered by src/http/api.spec.ts and the wire by route.spec.ts; this is the express wiring. */
describe('toExpress', () => {
  let app: express.Express;
  let mockQuerier: MockedQuerier;
  let pool: QuerierPool;

  function mount(use: ApiMiddleware<express.Request>[] = []) {
    app = express();
    app.set('query parser', 'extended');
    app.use('/api/v1', toExpress(createApi({ pool, include: [User], use })));
    app.use((_req, res) => {
      res.status(404).json({ fellThrough: true });
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuerier = createMockQuerier();
    pool = createMockQuerierPool(new PostgresDialect(), async () => mockQuerier);
    mount();
  });

  it('should read with the call in q', async () => {
    mockQuerier.findMany.mockResolvedValue([{ id: 1, name: 'John' }]);

    const res = await request(app).get(`/api/v1/user/findMany${q({ query: { $limit: 5 } })}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [{ id: 1, name: 'John' }] });
    expect(mockQuerier.findMany).toHaveBeenCalledWith(User, expect.objectContaining({ $limit: 5 }));
  });

  it('should write the payload of a JSON POST', async () => {
    mockQuerier.insertOne.mockResolvedValue(1);

    const res = await request(app)
      .post('/api/v1/user/insertOne')
      .send({ payload: { name: 'John' } });

    expect(res.body).toEqual({ data: 1 });
    expect(mockQuerier.insertOne).toHaveBeenCalledWith(User, { name: 'John' });
  });

  it('should refuse a write sent as GET with its Allow header', async () => {
    const res = await request(app).get('/api/v1/user/insertOne');

    expect(res.status).toBe(405);
    expect(res.headers['allow']).toBe('POST');
  });

  it('should refuse a form post', async () => {
    const res = await request(app).post('/api/v1/user/insertOne').type('form').send('payload=1');

    expect(res.status).toBe(415);
  });

  it('should answer a malformed body with the envelope', async () => {
    const res = await request(app).post('/api/v1/user/insertOne').type('json').send('{bad');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { message: 'invalid JSON body', status: 400, kind: 'usage' } });
  });

  it('should answer a body past the size limit with the envelope', async () => {
    const res = await request(app)
      .post('/api/v1/user/insertMany')
      .send({ payload: [{ name: 'a'.repeat(200_000) }] });

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: { message: 'the body could not be read', status: 413, kind: 'usage' } });
  });

  /** An app parsing JSON everywhere hands the router a body read already, which it takes as it is. */
  it('should take a body parsed by an express.json() mounted before it', async () => {
    mockQuerier.insertOne.mockResolvedValue(1);
    app = express();
    app.use(express.json(), toExpress(createApi({ pool, include: [User] })));

    const res = await request(app)
      .post('/user/insertOne')
      .send({ payload: { name: 'John' } });

    expect(res.body).toEqual({ data: 1 });
    expect(mockQuerier.insertOne).toHaveBeenCalledWith(User, { name: 'John' });
  });

  it('should leave the body of a route it does not serve unread', async () => {
    const res = await request(app).post('/api/v1/other/insertOne').type('json').send('{bad');

    expect(res.body).toEqual({ fellThrough: true });
  });

  /** The extended parser reads `q[a]=1` as an object: only the JSON text a client sends is a call. */
  it('should refuse a q the query parser read as an object', async () => {
    const res = await request(app).get('/api/v1/user/findMany?q[query]=1');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ path: ['q'] });
  });

  it.each(['/api/v1/other/findMany', '/api/v1/user/aggregate', '/api/v1/user'])(
    'should fall through on %s',
    async (path) => {
      const res = await request(app).get(path);

      expect(res.body).toEqual({ fellThrough: true });
    },
  );

  it('should hand middleware the express request as context', async () => {
    mockQuerier.findMany.mockResolvedValue([]);
    mount([
      (call, req, next) =>
        next({
          ...call,
          query: {
            ...call.query,
            $where: Object.assign({}, call.query.$where, { companyId: req.get('x-company-id') }),
          },
        }),
    ]);

    await request(app).get('/api/v1/user/findMany').set('x-company-id', '40');

    expect(mockQuerier.findMany).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { companyId: '40' } }));
  });
});
