import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { getContext } from '../context/context.js';
import * as options from '../options.js';
import { createMockQuerier, type MockedQuerier, User } from '../test/index.js';
import { createRequestHandler, type HandlerRequest } from './handler.js';

vi.mock('../options.js');

describe('createRequestHandler', () => {
  let mockQuerier: MockedQuerier;

  const req = (partial: Partial<HandlerRequest> & Pick<HandlerRequest, 'method' | 'entityPath'>): HandlerRequest => ({
    context: undefined,
    ...partial,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuerier = createMockQuerier();
    (options.getQuerier as Mock).mockResolvedValue(mockQuerier);
  });

  it('throws if no entities are provided', () => {
    expect(() => createRequestHandler({ include: [] })).toThrow('no entities for the uql middleware');
  });

  it('returns undefined for unknown entity or route', () => {
    const handle = createRequestHandler({ include: [User] });
    expect(handle(req({ method: 'GET', entityPath: 'unknown-entity' }))).toBeUndefined();
    expect(handle(req({ method: 'OPTIONS', entityPath: 'user' }))).toBeUndefined();
    expect(handle(req({ method: 'POST', entityPath: 'user', subPath: 'one' }))).toBeUndefined();
  });

  it('respects exclude', () => {
    class OtherEntity {}
    const handle = createRequestHandler({ include: [User, OtherEntity], exclude: [OtherEntity] });
    expect(handle(req({ method: 'GET', entityPath: 'other-entity' }))).toBeUndefined();
  });

  it('findOne', async () => {
    mockQuerier.findOne.mockResolvedValue({ id: 1, name: 'John' });
    const handle = createRequestHandler({ include: [User] });
    const resp = await handle(
      req({ method: 'GET', entityPath: 'user', subPath: 'one', query: { $where: JSON.stringify({ name: 'John' }) } }),
    );
    expect(resp).toEqual({ status: 200, body: { data: { id: 1, name: 'John' }, count: 1 } });
    expect(mockQuerier.findOne).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { name: 'John' } }));
    expect(mockQuerier.release).toHaveBeenCalled();
  });

  it('wires getContext into the ambient context for the whole request', async () => {
    let seen: unknown;
    mockQuerier.findOne.mockImplementation(async () => {
      seen = getContext();
      return { id: 1 };
    });
    const handle = createRequestHandler<{ tid: number }>({
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

  it('findOne returns null', async () => {
    mockQuerier.findOne.mockResolvedValue(null);
    const handle = createRequestHandler({ include: [User] });
    const resp = await handle(req({ method: 'GET', entityPath: 'user', subPath: 'one' }));
    expect(resp).toEqual({ status: 200, body: { data: null, count: 0 } });
  });

  it('count', async () => {
    mockQuerier.count.mockResolvedValue(5);
    const handle = createRequestHandler({ include: [User] });
    const resp = await handle(req({ method: 'GET', entityPath: 'user', subPath: 'count' }));
    expect(resp).toEqual({ status: 200, body: { data: 5, count: 5 } });
  });

  it('findOneById', async () => {
    mockQuerier.findOne.mockResolvedValue({ id: 123 });
    const handle = createRequestHandler({ include: [User] });
    const resp = await handle(req({ method: 'GET', entityPath: 'user', subPath: '123' }));
    expect(resp).toEqual({ status: 200, body: { data: { id: 123 }, count: 1 } });
    expect(mockQuerier.findOne).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { id: '123' } }));
  });

  it('findOneById merges an object $where', async () => {
    mockQuerier.findOne.mockResolvedValue({ id: 123 });
    const handle = createRequestHandler({ include: [User] });
    await handle(req({ method: 'GET', entityPath: 'user', subPath: '123', query: { $where: '{"name":"John"}' } }));
    expect(mockQuerier.findOne).toHaveBeenCalledWith(
      User,
      expect.objectContaining({ $where: { id: '123', name: 'John' } }),
    );
  });

  it('findOneById preserves an array $where via $and (no silent overwrite)', async () => {
    mockQuerier.findOne.mockResolvedValue({ id: 123 });
    const handle = createRequestHandler({ include: [User] });
    await handle(req({ method: 'GET', entityPath: 'user', subPath: '123', query: { $where: '[1, 2]' } }));
    expect(mockQuerier.findOne).toHaveBeenCalledWith(
      User,
      expect.objectContaining({ $where: { $and: [{ id: { $in: [1, 2] } }, { id: '123' }] } }),
    );
  });

  it('findMany', async () => {
    mockQuerier.findMany.mockResolvedValue([{ id: 1 }]);
    const handle = createRequestHandler({ include: [User] });
    const resp = await handle(req({ method: 'GET', entityPath: 'user' }));
    expect(resp).toEqual({ status: 200, body: { data: [{ id: 1 }], count: undefined } });
    expect(mockQuerier.count).not.toHaveBeenCalled();
  });

  it('findMany with count', async () => {
    mockQuerier.findMany.mockResolvedValue([{ id: 1 }]);
    mockQuerier.count.mockResolvedValue(1);
    const handle = createRequestHandler({ include: [User] });
    const resp = await handle(req({ method: 'GET', entityPath: 'user', query: { count: 'true' } }));
    expect(resp).toEqual({ status: 200, body: { data: [{ id: 1 }], count: 1 } });
  });

  it('QUERY (RFC 10008) reads take the query from the body and hit preFilter', async () => {
    mockQuerier.findMany.mockResolvedValue([{ id: 1 }]);
    mockQuerier.count.mockResolvedValue(1);
    const preFilter = vi.fn();
    const preSave = vi.fn();
    const handle = createRequestHandler({ include: [User], preFilter, preSave });
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

  it('insertOne runs in a transaction', async () => {
    mockQuerier.insertOne.mockResolvedValue(1);
    const handle = createRequestHandler({ include: [User] });
    const resp = await handle(req({ method: 'POST', entityPath: 'user', body: { name: 'John' } }));
    expect(resp).toEqual({ status: 200, body: { data: 1, count: 1 } });
    expect(mockQuerier.beginTransaction).toHaveBeenCalled();
    expect(mockQuerier.insertOne).toHaveBeenCalledWith(User, { name: 'John' });
    expect(mockQuerier.commitTransaction).toHaveBeenCalled();
    expect(mockQuerier.release).toHaveBeenCalled();
  });

  it('insertMany', async () => {
    mockQuerier.insertMany.mockResolvedValue([1, 2]);
    const handle = createRequestHandler({ include: [User] });
    const resp = await handle(
      req({ method: 'POST', entityPath: 'user', subPath: 'many', body: [{ name: 'a' }, { name: 'b' }] }),
    );
    expect(resp).toEqual({ status: 200, body: { data: [1, 2], count: 2 } });
    expect(mockQuerier.insertMany).toHaveBeenCalledWith(User, [{ name: 'a' }, { name: 'b' }]);
  });

  it('saveOne', async () => {
    mockQuerier.saveOne.mockResolvedValue(1);
    const handle = createRequestHandler({ include: [User] });
    const resp = await handle(req({ method: 'PUT', entityPath: 'user', body: { id: 1, name: 'John' } }));
    expect(resp).toEqual({ status: 200, body: { data: 1, count: 1 } });
    expect(mockQuerier.saveOne).toHaveBeenCalledWith(User, { id: 1, name: 'John' });
  });

  it('saveMany', async () => {
    mockQuerier.saveMany.mockResolvedValue([1, 2]);
    const handle = createRequestHandler({ include: [User] });
    const resp = await handle(
      req({ method: 'PUT', entityPath: 'user', subPath: 'many', body: [{ id: 1 }, { name: 'new' }] }),
    );
    expect(resp).toEqual({ status: 200, body: { data: [1, 2], count: 2 } });
  });

  it('updateOneById', async () => {
    mockQuerier.updateMany.mockResolvedValue(1);
    const handle = createRequestHandler({ include: [User] });
    const resp = await handle(req({ method: 'PATCH', entityPath: 'user', subPath: '1', body: { name: 'John' } }));
    expect(resp).toEqual({ status: 200, body: { data: '1', count: 1 } });
    expect(mockQuerier.updateMany).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { id: '1' } }), {
      name: 'John',
    });
  });

  it('updateOneById preserves an array $where via $and', async () => {
    mockQuerier.updateMany.mockResolvedValue(1);
    const handle = createRequestHandler({ include: [User] });
    await handle(
      req({ method: 'PATCH', entityPath: 'user', subPath: '9', query: { $where: '[1, 9]' }, body: { name: 'x' } }),
    );
    expect(mockQuerier.updateMany).toHaveBeenCalledWith(
      User,
      expect.objectContaining({ $where: { $and: [{ id: { $in: [1, 9] } }, { id: '9' }] } }),
      { name: 'x' },
    );
  });

  it('updateMany (bulk)', async () => {
    mockQuerier.updateMany.mockResolvedValue(3);
    const handle = createRequestHandler({ include: [User] });
    const resp = await handle(
      req({ method: 'PATCH', entityPath: 'user', query: { $where: '{"status":1}' }, body: { status: 2 } }),
    );
    expect(resp).toEqual({ status: 200, body: { data: 3, count: 3 } });
    expect(mockQuerier.updateMany).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { status: 1 } }), {
      status: 2,
    });
  });

  it('deleteOneById with ?hardDelete', async () => {
    mockQuerier.deleteMany.mockResolvedValue(1);
    const handle = createRequestHandler({ include: [User] });
    const resp = await handle(
      req({ method: 'DELETE', entityPath: 'user', subPath: '1', query: { hardDelete: 'true' } }),
    );
    expect(resp).toEqual({ status: 200, body: { data: '1', count: 1 } });
    expect(mockQuerier.deleteMany).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { id: '1' } }), {
      hardDelete: true,
    });
  });

  it('deleteOneById preserves an array $where via $and (soft by default)', async () => {
    mockQuerier.deleteMany.mockResolvedValue(1);
    const handle = createRequestHandler({ include: [User] });
    await handle(req({ method: 'DELETE', entityPath: 'user', subPath: '9', query: { $where: '[1, 9]' } }));
    expect(mockQuerier.deleteMany).toHaveBeenCalledWith(
      User,
      expect.objectContaining({ $where: { $and: [{ id: { $in: [1, 9] } }, { id: '9' }] } }),
      { hardDelete: false },
    );
  });

  it('deleteMany deletes by found ids (soft by default)', async () => {
    mockQuerier.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    mockQuerier.deleteMany.mockResolvedValue(2);
    const handle = createRequestHandler({ include: [User] });
    const resp = await handle(req({ method: 'DELETE', entityPath: 'user' }));
    expect(resp).toEqual({ status: 200, body: { data: [1, 2], count: 2 } });
    expect(mockQuerier.deleteMany).toHaveBeenCalledWith(User, { $where: [1, 2] }, { hardDelete: false });
  });

  it('deleteMany when nothing found', async () => {
    mockQuerier.findMany.mockResolvedValue([]);
    const handle = createRequestHandler({ include: [User] });
    const resp = await handle(req({ method: 'DELETE', entityPath: 'user' }));
    expect(resp).toEqual({ status: 200, body: { data: [], count: 0 } });
    expect(mockQuerier.deleteMany).not.toHaveBeenCalled();
  });

  it('read errors release the querier and propagate', async () => {
    mockQuerier.findOne.mockRejectedValue(new Error('One error'));
    const handle = createRequestHandler({ include: [User] });
    await expect(handle(req({ method: 'GET', entityPath: 'user', subPath: 'one' }))).rejects.toThrow('One error');
    expect(mockQuerier.release).toHaveBeenCalled();
  });

  it('write errors rollback, release, and propagate', async () => {
    mockQuerier.insertOne.mockRejectedValue(new Error('Insert error'));
    const handle = createRequestHandler({ include: [User] });
    await expect(handle(req({ method: 'POST', entityPath: 'user', body: {} }))).rejects.toThrow('Insert error');
    expect(mockQuerier.rollbackTransaction).toHaveBeenCalled();
    expect(mockQuerier.commitTransaction).not.toHaveBeenCalled();
    expect(mockQuerier.release).toHaveBeenCalled();
  });

  it('swallows rollback errors and keeps the original one', async () => {
    mockQuerier.insertOne.mockRejectedValue(new Error('Insert error'));
    mockQuerier.rollbackTransaction.mockRejectedValue(new Error('Rollback error'));
    const handle = createRequestHandler({ include: [User] });
    await expect(handle(req({ method: 'POST', entityPath: 'user', body: {} }))).rejects.toThrow('Insert error');
    expect(mockQuerier.release).toHaveBeenCalled();
  });

  describe('hooks', () => {
    it('runs pre on every request and preFilter on reads', async () => {
      mockQuerier.findMany.mockResolvedValue([]);
      const pre = vi.fn();
      const preFilter = vi.fn();
      const preSave = vi.fn();
      const handle = createRequestHandler({ include: [User], pre, preFilter, preSave });
      await handle(req({ method: 'GET', entityPath: 'user' }));
      expect(pre).toHaveBeenCalledTimes(1);
      expect(preFilter).toHaveBeenCalledTimes(1);
      expect(preSave).not.toHaveBeenCalled();
      const ctx = preFilter.mock.calls[0][0];
      expect(ctx.op).toBe('findMany');
      expect(ctx.method).toBe('GET');
      expect(ctx.meta.entity).toBe(User);
    });

    it('runs preSave on writes', async () => {
      mockQuerier.insertOne.mockResolvedValue(1);
      const preFilter = vi.fn();
      const preSave = vi.fn();
      const handle = createRequestHandler({ include: [User], preFilter, preSave });
      await handle(req({ method: 'POST', entityPath: 'user', body: { name: 'a' } }));
      expect(preSave).toHaveBeenCalledTimes(1);
      expect(preFilter).not.toHaveBeenCalled();
    });

    it('hook mutations of the query reach the querier (tenant scoping)', async () => {
      mockQuerier.findMany.mockResolvedValue([]);
      const handle = createRequestHandler<{ companyId: number }>({
        include: [User],
        preFilter: async ({ query, context }) => {
          query.$where ??= {};
          Object.assign(query.$where as object, { companyId: context.companyId });
        },
      });
      await handle({ method: 'GET', entityPath: 'user', context: { companyId: 40 } });
      expect(mockQuerier.findMany).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { companyId: 40 } }));
    });

    it('hook reassignment of the body reaches the querier', async () => {
      mockQuerier.insertOne.mockResolvedValue(1);
      const handle = createRequestHandler({
        include: [User],
        preSave: (ctx) => {
          ctx.body = { ...(ctx.body as object), creatorId: 7 };
        },
      });
      await handle(req({ method: 'POST', entityPath: 'user', body: { name: 'a' } }));
      expect(mockQuerier.insertOne).toHaveBeenCalledWith(User, { name: 'a', creatorId: 7 });
    });

    it('post can strip and derive response fields (SafeIntegration pattern)', async () => {
      mockQuerier.findMany.mockResolvedValue([{ id: 1, name: 'slack', accessToken: 'secret' }]);
      const handle = createRequestHandler({
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

    it('post can coerce null data and runs after commit on writes', async () => {
      mockQuerier.findOne.mockResolvedValue(null);
      const events: string[] = [];
      const handle = createRequestHandler({
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

    it('hooks can enforce hardDelete (flags are resolved after hooks run)', async () => {
      mockQuerier.deleteMany.mockResolvedValue(1);
      const handle = createRequestHandler({
        include: [User],
        preFilter: ({ query }) => {
          Object.assign(query, { hardDelete: true });
        },
      });
      await handle(req({ method: 'DELETE', entityPath: 'user', subPath: '1' }));
      expect(mockQuerier.deleteMany).toHaveBeenCalledWith(User, expect.anything(), { hardDelete: true });
    });

    it('an async hook that throws aborts before touching the pool', async () => {
      const err = Object.assign(new Error('forbidden'), { status: 403 });
      const handle = createRequestHandler({
        include: [User],
        pre: async () => {
          throw err;
        },
      });
      await expect(handle(req({ method: 'GET', entityPath: 'user' }))).rejects.toBe(err);
      expect(options.getQuerier).not.toHaveBeenCalled();
    });
  });
});
