import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getContext } from '../context/context.js';
import { defineEntity, getMeta } from '../entity/index.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { createMockQuerier, createMockQuerierPool, Item, type MockedQuerier, Tax, User } from '../test/index.js';
import type { QuerierPool } from '../type/index.js';
import { createRequestHandler, type HandlerRequest } from './handler.js';

describe('createRequestHandler', () => {
  let mockQuerier: MockedQuerier;
  let pool: QuerierPool;

  const req = (partial: Partial<HandlerRequest> & Pick<HandlerRequest, 'method' | 'entityPath'>): HandlerRequest => ({
    context: undefined,
    ...partial,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuerier = createMockQuerier();
    pool = createMockQuerierPool(new PostgresDialect(), async () => mockQuerier);
  });

  /** The route is one path segment, which a composite key has no spelling for on either side yet. */
  it('should refuse a by-id route on a composite key, naming the handler', async () => {
    class Enrolment {
      studentId?: number;
      courseId?: string;
    }
    defineEntity(Enrolment, {
      fields: { studentId: { type: Number, isId: true }, courseId: { type: String, isId: true } },
    });
    const handle = createRequestHandler({ include: [Enrolment], pool });

    await expect(handle(req({ method: 'GET', entityPath: 'enrolment', subPath: '1' }))).rejects.toThrow(
      /composite primary key \(studentId, courseId\), which the HTTP handler does not support/,
    );
  });

  it('should run on the pool it is given', async () => {
    const ownQuerier = createMockQuerier();
    const handle = createRequestHandler({
      include: [User],
      pool: createMockQuerierPool(new PostgresDialect(), async () => ownQuerier),
    });

    await handle(req({ method: 'GET', entityPath: 'user' }));

    expect(ownQuerier.findMany).toHaveBeenCalled();
    expect(mockQuerier.findMany).not.toHaveBeenCalled();
  });

  it('should pick the pool per request, after the context it resolved', async () => {
    const tenantQuerier = createMockQuerier();
    const seen: unknown[] = [];
    const handle = createRequestHandler<{ tenantId: number }>({
      include: [User],
      getContext: (context) => ({ tenantId: context.tenantId }),
      pool: (context, appContext) => {
        seen.push([context.tenantId, appContext['tenantId']]);
        return createMockQuerierPool(new PostgresDialect(), async () => tenantQuerier);
      },
    });

    await handle({ method: 'GET', entityPath: 'user', context: { tenantId: 7 } });

    expect(seen).toEqual([[7, 7]]);
    expect(tenantQuerier.findMany).toHaveBeenCalled();
  });

  it('should throw if no entities are provided', () => {
    expect(() => createRequestHandler({ pool, include: [] })).toThrow('no entities for the uql middleware');
  });

  // The path comes from the class name, so two entities on the same table in different schemas would
  // land on one path, the second unreachable.
  it('should throw when two entities claim the same path', () => {
    class Company {
      id?: number;
    }
    defineEntity(Company, { schema: 'crm', fields: { id: { isId: true, type: Number } } });
    const Shadow = class Company {
      id?: number;
    };
    defineEntity(Shadow, { schema: 'billing', name: 'Company', fields: { id: { isId: true, type: Number } } });

    expect(() => createRequestHandler({ pool, include: [Company, Shadow] })).toThrow(
      '/company <- Company (crm.Company), Company (billing.Company)',
    );

    // Which is what `entityPath` is for: the two are one table in two schemas, so the schema is what
    // tells their routes apart.
    const handle = createRequestHandler({
      pool,
      include: [Company, Shadow],
      entityPath: (entity) => `${getMeta(entity).schema}-company`,
    });
    expect(handle(req({ method: 'GET', entityPath: 'crm-company', subPath: 'one' }))).toBeDefined();
    expect(handle(req({ method: 'GET', entityPath: 'billing-company', subPath: 'one' }))).toBeDefined();
  });

  it('should return undefined for unknown entity or route', () => {
    const handle = createRequestHandler({ pool, include: [User] });
    expect(handle(req({ method: 'GET', entityPath: 'unknown-entity' }))).toBeUndefined();
    expect(handle(req({ method: 'OPTIONS', entityPath: 'user' }))).toBeUndefined();
    expect(handle(req({ method: 'POST', entityPath: 'user', subPath: 'one' }))).toBeUndefined();
  });

  it('should respect exclude', () => {
    class OtherEntity {}
    const handle = createRequestHandler({ pool, include: [User, OtherEntity], exclude: [OtherEntity] });
    expect(handle(req({ method: 'GET', entityPath: 'other-entity' }))).toBeUndefined();
  });

  it('should find one row', async () => {
    mockQuerier.findOne.mockResolvedValue({ id: 1, name: 'John' });
    const handle = createRequestHandler({ pool, include: [User] });
    const resp = await handle(
      req({ method: 'GET', entityPath: 'user', subPath: 'one', query: { $where: JSON.stringify({ name: 'John' }) } }),
    );
    expect(resp).toEqual({ status: 200, body: { data: { id: 1, name: 'John' }, count: 1 } });
    expect(mockQuerier.findOne).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { name: 'John' } }));
    expect(mockQuerier.release).toHaveBeenCalled();
  });

  it('should wire getContext into the ambient context for the whole request', async () => {
    let seen: unknown;
    mockQuerier.findOne.mockImplementation(async () => {
      seen = getContext();
      return { id: 1 };
    });
    const handle = createRequestHandler<{ tid: number }>({
      pool,
      include: [User],
      getContext: (ctx) => ({ tenantId: ctx?.tid }),
    });
    await handle(
      req({ method: 'GET', entityPath: 'user', subPath: 'one', context: { tid: 7 } }) as HandlerRequest<{
        tid: number;
      }>,
    );
    expect(seen).toEqual({ tenantId: 7 });
  });

  it('should answer null where findOne finds none', async () => {
    mockQuerier.findOne.mockResolvedValue(null);
    const handle = createRequestHandler({ pool, include: [User] });
    const resp = await handle(req({ method: 'GET', entityPath: 'user', subPath: 'one' }));
    expect(resp).toEqual({ status: 200, body: { data: null, count: 0 } });
  });

  it('should count rows', async () => {
    mockQuerier.count.mockResolvedValue(5);
    const handle = createRequestHandler({ pool, include: [User] });
    const resp = await handle(req({ method: 'GET', entityPath: 'user', subPath: 'count' }));
    expect(resp).toEqual({ status: 200, body: { data: 5, count: 5 } });
  });

  /** What the client's `exists` sends: the cap has to reach the querier, or it counts every match. */
  it('should honor a $limit from the wire on count', async () => {
    mockQuerier.count.mockResolvedValue(1);
    const handle = createRequestHandler({ pool, include: [User] });
    const resp = await handle(req({ method: 'GET', entityPath: 'user', subPath: 'count', query: { $limit: '1' } }));
    expect(mockQuerier.count).toHaveBeenCalledWith(User, expect.objectContaining({ $limit: 1 }));
    expect(resp).toEqual({ status: 200, body: { data: 1, count: 1 } });
  });

  it('should find one row by id', async () => {
    mockQuerier.findOne.mockResolvedValue({ id: 123 });
    const handle = createRequestHandler({ pool, include: [User] });
    const resp = await handle(req({ method: 'GET', entityPath: 'user', subPath: '123' }));
    expect(resp).toEqual({ status: 200, body: { data: { id: 123 }, count: 1 } });
    expect(mockQuerier.findOne).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { id: '123' } }));
  });

  it('should answer a count of zero where no row has the id', async () => {
    mockQuerier.findOne.mockResolvedValue(undefined);
    const handle = createRequestHandler({ pool, include: [User] });
    const resp = await handle(req({ method: 'GET', entityPath: 'user', subPath: '123' }));
    expect(resp).toEqual({ status: 200, body: { data: undefined, count: 0 } });
  });

  it('should merge an object $where into a read by id', async () => {
    mockQuerier.findOne.mockResolvedValue({ id: 123 });
    const handle = createRequestHandler({ pool, include: [User] });
    await handle(req({ method: 'GET', entityPath: 'user', subPath: '123', query: { $where: '{"name":"John"}' } }));
    expect(mockQuerier.findOne).toHaveBeenCalledWith(
      User,
      expect.objectContaining({ $where: { id: '123', name: 'John' } }),
    );
  });

  it('should find rows', async () => {
    mockQuerier.findMany.mockResolvedValue([{ id: 1 }]);
    const handle = createRequestHandler({ pool, include: [User] });
    const resp = await handle(req({ method: 'GET', entityPath: 'user' }));
    expect(resp).toEqual({ status: 200, body: { data: [{ id: 1 }], count: undefined } });
    expect(mockQuerier.count).not.toHaveBeenCalled();
  });

  it('should find rows with their count', async () => {
    mockQuerier.findMany.mockResolvedValue([{ id: 1 }]);
    mockQuerier.count.mockResolvedValue(1);
    const handle = createRequestHandler({ pool, include: [User] });
    const resp = await handle(req({ method: 'GET', entityPath: 'user', query: { count: 'true' } }));
    expect(resp).toEqual({ status: 200, body: { data: [{ id: 1 }], count: 1 } });
  });

  it('should not count rows on ?count=false', async () => {
    const handle = createRequestHandler({ pool, include: [User] });
    await handle(req({ method: 'GET', entityPath: 'user', query: { count: 'false' } }));
    expect(mockQuerier.count).not.toHaveBeenCalled();
  });

  it("should take a QUERY read's query from the body, through preFilter", async () => {
    mockQuerier.findMany.mockResolvedValue([{ id: 1 }]);
    mockQuerier.count.mockResolvedValue(1);
    const preFilter = vi.fn();
    const preSave = vi.fn();
    const handle = createRequestHandler({ pool, include: [User], preFilter, preSave });
    const resp = await handle(
      req({ method: 'QUERY', entityPath: 'user', body: { $where: { name: 'John' }, $limit: 5, count: true } }),
    );
    expect(resp).toEqual({ status: 200, body: { data: [{ id: 1 }], count: 1 } });
    expect(mockQuerier.findMany).toHaveBeenCalledWith(
      User,
      expect.objectContaining({ $where: { name: 'John' }, $limit: 5 }),
    );
    expect(preFilter).toHaveBeenCalledTimes(1);
    expect(preFilter.mock.calls[0][0].method).toBe('QUERY');
    expect(preFilter.mock.calls[0][0].op).toBe('findMany');
    expect(preSave).not.toHaveBeenCalled();
  });

  it('should insert one row in a transaction', async () => {
    mockQuerier.insertOne.mockResolvedValue(1);
    const handle = createRequestHandler({ pool, include: [User] });
    const resp = await handle(req({ method: 'POST', entityPath: 'user', body: { name: 'John' } }));
    expect(resp).toEqual({ status: 200, body: { data: 1, count: 1 } });
    expect(mockQuerier.beginTransaction).toHaveBeenCalled();
    expect(mockQuerier.insertOne).toHaveBeenCalledWith(User, { name: 'John' });
    expect(mockQuerier.commitTransaction).toHaveBeenCalled();
    expect(mockQuerier.release).toHaveBeenCalled();
  });

  it('should insert rows', async () => {
    mockQuerier.insertMany.mockResolvedValue([1, 2]);
    const handle = createRequestHandler({ pool, include: [User] });
    const resp = await handle(
      req({ method: 'POST', entityPath: 'user', subPath: 'many', body: [{ name: 'a' }, { name: 'b' }] }),
    );
    expect(resp).toEqual({ status: 200, body: { data: [1, 2], count: 2 } });
    expect(mockQuerier.insertMany).toHaveBeenCalledWith(User, [{ name: 'a' }, { name: 'b' }]);
  });

  it('should save one row', async () => {
    mockQuerier.saveOne.mockResolvedValue(1);
    const handle = createRequestHandler({ pool, include: [User] });
    const resp = await handle(req({ method: 'PUT', entityPath: 'user', body: { id: 1, name: 'John' } }));
    expect(resp).toEqual({ status: 200, body: { data: 1, count: 1 } });
    expect(mockQuerier.saveOne).toHaveBeenCalledWith(User, { id: 1, name: 'John' });
  });

  it('should save rows', async () => {
    mockQuerier.saveMany.mockResolvedValue([1, 2]);
    const handle = createRequestHandler({ pool, include: [User] });
    const resp = await handle(
      req({ method: 'PUT', entityPath: 'user', subPath: 'many', body: [{ id: 1 }, { name: 'new' }] }),
    );
    expect(resp).toEqual({ status: 200, body: { data: [1, 2], count: 2 } });
  });

  it('should update one row by id', async () => {
    mockQuerier.updateMany.mockResolvedValue(1);
    const handle = createRequestHandler({ pool, include: [User] });
    const resp = await handle(req({ method: 'PATCH', entityPath: 'user', subPath: '1', body: { name: 'John' } }));
    expect(resp).toEqual({ status: 200, body: { data: '1', count: 1 } });
    expect(mockQuerier.updateMany).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { id: '1' } }), {
      name: 'John',
    });
  });

  it('should update the rows a query matches', async () => {
    mockQuerier.updateMany.mockResolvedValue(3);
    const handle = createRequestHandler({ pool, include: [User] });
    const resp = await handle(
      req({ method: 'PATCH', entityPath: 'user', query: { $where: '{"status":1}' }, body: { status: 2 } }),
    );
    expect(resp).toEqual({ status: 200, body: { data: 3, count: 3 } });
    expect(mockQuerier.updateMany).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { status: 1 } }), {
      status: 2,
    });
  });

  it('should delete one row by id, hard with ?hardDelete', async () => {
    mockQuerier.deleteMany.mockResolvedValue(1);
    const handle = createRequestHandler({ pool, include: [User] });
    const resp = await handle(
      req({ method: 'DELETE', entityPath: 'user', subPath: '1', query: { hardDelete: 'true' } }),
    );
    expect(resp).toEqual({ status: 200, body: { data: '1', count: 1 } });
    expect(mockQuerier.deleteMany).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { id: '1' } }), {
      hardDelete: true,
    });
  });

  it('should delete by the ids it found, softly by default', async () => {
    mockQuerier.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    mockQuerier.deleteMany.mockResolvedValue(2);
    const handle = createRequestHandler({ pool, include: [User] });
    const resp = await handle(req({ method: 'DELETE', entityPath: 'user' }));
    expect(resp).toEqual({ status: 200, body: { data: [1, 2], count: 2 } });
    expect(mockQuerier.deleteMany).toHaveBeenCalledWith(User, { $where: { id: [1, 2] } }, { hardDelete: false });
  });

  it('should delete nothing where nothing is found', async () => {
    mockQuerier.findMany.mockResolvedValue([]);
    const handle = createRequestHandler({ pool, include: [User] });
    const resp = await handle(req({ method: 'DELETE', entityPath: 'user' }));
    expect(resp).toEqual({ status: 200, body: { data: [], count: 0 } });
    expect(mockQuerier.deleteMany).not.toHaveBeenCalled();
  });

  it('should release the querier and propagate a read error', async () => {
    mockQuerier.findOne.mockRejectedValue(new Error('One error'));
    const handle = createRequestHandler({ pool, include: [User] });
    await expect(handle(req({ method: 'GET', entityPath: 'user', subPath: 'one' }))).rejects.toThrow('One error');
    expect(mockQuerier.release).toHaveBeenCalled();
  });

  it('should roll back, release and propagate a write error', async () => {
    mockQuerier.insertOne.mockRejectedValue(new Error('Insert error'));
    const handle = createRequestHandler({ pool, include: [User] });
    await expect(handle(req({ method: 'POST', entityPath: 'user', body: {} }))).rejects.toThrow('Insert error');
    expect(mockQuerier.rollbackTransaction).toHaveBeenCalled();
    expect(mockQuerier.commitTransaction).not.toHaveBeenCalled();
    expect(mockQuerier.release).toHaveBeenCalled();
  });

  it('should swallow rollback errors and keep the original one', async () => {
    mockQuerier.insertOne.mockRejectedValue(new Error('Insert error'));
    mockQuerier.rollbackTransaction.mockRejectedValue(new Error('Rollback error'));
    const handle = createRequestHandler({ pool, include: [User] });
    await expect(handle(req({ method: 'POST', entityPath: 'user', body: {} }))).rejects.toThrow('Insert error');
    expect(mockQuerier.release).toHaveBeenCalled();
  });

  describe('relations reaching an entity the handler does not serve', () => {
    const served = () => createRequestHandler({ include: [Item, Tax], pool });

    it.each([
      { clause: '$populate', value: { tags: true }, path: 'tags', target: 'Tag' },
      {
        clause: '$populate',
        value: { tax: { $populate: { category: true } } },
        path: 'tax.category',
        target: 'TaxCategory',
      },
      { clause: '$where', value: { tags: { name: 'a' } }, path: 'tags', target: 'Tag' },
      {
        clause: '$where',
        value: { $or: [{ measureUnit: { name: 'kg' } }] },
        path: 'measureUnit',
        target: 'MeasureUnit',
      },
      { clause: '$sort', value: { tax: { category: { name: 1 } } }, path: 'tax.category', target: 'TaxCategory' },
      { clause: '$count', value: { tags: { $where: { name: 'a' } } }, path: 'tags', target: 'Tag' },
    ])('should refuse $clause reaching $target', async ({ clause, value, path, target }) => {
      const read = served()(req({ method: 'GET', entityPath: 'item', query: { [clause]: JSON.stringify(value) } }));

      await expect(read).rejects.toThrow(`'${path}' reaches '${target}', which this handler does not serve`);
      expect(mockQuerier.findMany).not.toHaveBeenCalled();
    });

    it('should refuse a written row reaching one', async () => {
      const write = served()(req({ method: 'POST', entityPath: 'item', body: { name: 'a', tags: [{ name: 't' }] } }));

      await expect(write).rejects.toThrow("'tags' reaches 'Tag', which this handler does not serve");
      expect(mockQuerier.insertOne).not.toHaveBeenCalled();
    });

    it('should read a relation to an entity it serves', async () => {
      const query = { $populate: JSON.stringify({ tax: true }), $where: JSON.stringify({ tax: { name: 'VAT' } }) };

      await served()(req({ method: 'GET', entityPath: 'item', query }));

      expect(mockQuerier.findMany).toHaveBeenCalledWith(Item, expect.objectContaining({ $populate: { tax: true } }));
    });

    it("should leave a hook's own relations alone: the server writes those", async () => {
      const handle = createRequestHandler({
        include: [Item],
        pool,
        preFilter: ({ query }) => {
          Object.assign(query, { $populate: { tags: true } });
        },
      });

      await handle(req({ method: 'GET', entityPath: 'item' }));

      expect(mockQuerier.findMany).toHaveBeenCalledWith(Item, expect.objectContaining({ $populate: { tags: true } }));
    });
  });

  describe('hooks', () => {
    it('should run pre on every request and preFilter on reads', async () => {
      mockQuerier.findMany.mockResolvedValue([]);
      const pre = vi.fn();
      const preFilter = vi.fn();
      const preSave = vi.fn();
      const handle = createRequestHandler({ pool, include: [User], pre, preFilter, preSave });
      await handle(req({ method: 'GET', entityPath: 'user' }));
      expect(pre).toHaveBeenCalledTimes(1);
      expect(preFilter).toHaveBeenCalledTimes(1);
      expect(preSave).not.toHaveBeenCalled();
      const ctx = preFilter.mock.calls[0][0];
      expect(ctx.op).toBe('findMany');
      expect(ctx.method).toBe('GET');
      expect(ctx.meta.entity).toBe(User);
    });

    it('should run preSave on writes', async () => {
      mockQuerier.insertOne.mockResolvedValue(1);
      const preFilter = vi.fn();
      const preSave = vi.fn();
      const handle = createRequestHandler({ pool, include: [User], preFilter, preSave });
      await handle(req({ method: 'POST', entityPath: 'user', body: { name: 'a' } }));
      expect(preSave).toHaveBeenCalledTimes(1);
      expect(preFilter).not.toHaveBeenCalled();
    });

    /**
     * A hook can rewrite the outgoing query, but it scopes no tenant: unlike a `security: true` filter it
     * is not AND-merged, does not fail closed, and misses a relation populated without a `$where`.
     */
    it("should let a hook's query mutation reach the querier", async () => {
      mockQuerier.findMany.mockResolvedValue([]);
      const handle = createRequestHandler<{ companyId: number }>({
        pool,
        include: [User],
        preFilter: async ({ query, context }) => {
          query.$where ??= {};
          Object.assign(query.$where as object, { companyId: context.companyId });
        },
      });
      await handle({ method: 'GET', entityPath: 'user', context: { companyId: 40 } });
      expect(mockQuerier.findMany).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { companyId: 40 } }));
    });

    it("should let a hook's reassigned body reach the querier", async () => {
      mockQuerier.insertOne.mockResolvedValue(1);
      const handle = createRequestHandler({
        pool,
        include: [User],
        preSave: (ctx) => {
          ctx.body = { ...(ctx.body as object), creatorId: 7 };
        },
      });
      await handle(req({ method: 'POST', entityPath: 'user', body: { name: 'a' } }));
      expect(mockQuerier.insertOne).toHaveBeenCalledWith(User, { name: 'a', creatorId: 7 });
    });

    it('should let post strip and derive response fields', async () => {
      mockQuerier.findMany.mockResolvedValue([{ id: 1, name: 'slack', accessToken: 'secret' }]);
      const handle = createRequestHandler({
        pool,
        include: [User],
        post: (_ctx, envelope) => {
          envelope.data = (envelope.data as Array<{ accessToken?: string }>).map(({ accessToken, ...rest }) => ({
            ...rest,
            hasAccessToken: !!accessToken,
          }));
        },
      });
      const resp = await handle(req({ method: 'GET', entityPath: 'user' }));
      expect(resp).toEqual({
        status: 200,
        body: { data: [{ id: 1, name: 'slack', hasAccessToken: true }], count: undefined },
      });
    });

    it('should let post coerce null data, after the commit on a write', async () => {
      mockQuerier.findOne.mockResolvedValue(null);
      const events: string[] = [];
      const handle = createRequestHandler({
        pool,
        include: [User],
        post: async ({ op }, envelope) => {
          events.push(op);
          envelope.data ??= {};
        },
      });
      const read = await handle(req({ method: 'GET', entityPath: 'user', subPath: 'one' }));
      expect(read?.body).toEqual({ data: {}, count: 0 });

      mockQuerier.insertOne.mockResolvedValue(1);
      await handle(req({ method: 'POST', entityPath: 'user', body: { name: 'a' } }));
      expect(events).toEqual(['findOne', 'insertOne']);
      expect(mockQuerier.commitTransaction).toHaveBeenCalled();
    });

    it('should let hooks enforce hardDelete, the flags being resolved after them', async () => {
      mockQuerier.deleteMany.mockResolvedValue(1);
      const handle = createRequestHandler({
        pool,
        include: [User],
        preFilter: ({ query }) => {
          Object.assign(query, { hardDelete: true });
        },
      });
      await handle(req({ method: 'DELETE', entityPath: 'user', subPath: '1' }));
      expect(mockQuerier.deleteMany).toHaveBeenCalledWith(User, expect.anything(), { hardDelete: true });
    });

    it('should abort before touching the pool when an async hook throws', async () => {
      const err = Object.assign(new Error('forbidden'), { status: 403 });
      const handle = createRequestHandler({
        pool,
        include: [User],
        pre: async () => {
          throw err;
        },
      });
      await expect(handle(req({ method: 'GET', entityPath: 'user' }))).rejects.toBe(err);
      expect(mockQuerier.findMany).not.toHaveBeenCalled();
    });
  });
});
