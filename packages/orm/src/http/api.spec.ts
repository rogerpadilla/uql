import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getContext, withContext } from '../context/context.js';
import { defineEntity, Entity, f, Field, getMeta } from '../entity/index.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { createMockQuerier, createMockQuerierPool, Item, type MockedQuerier, Tax, User } from '../test/index.js';
import type { QuerierPool } from '../type/index.js';
import { isRecord } from '../util/object.util.js';
import { UqlRequestError } from '../util/uqlError.js';
import { createApi } from './api.js';
import type { ApiMiddleware, EntityMiddleware } from './apiCall.js';
import { serve } from './exposure.js';

type Scope = { readonly companyId: string };

/** Scopes a user's reads to the caller's company and stamps it on the users it inserts, typed by `User`. */
const scopedToCompany: EntityMiddleware<User, Scope> = (call, { companyId }, next) =>
  call.op === 'insertOne'
    ? next({ ...call, payload: { ...call.payload, companyId } })
    : next({ ...call, query: { ...call.query, $where: { ...call.query.$where, companyId } } });

/** Derives a field from a secret and drops the secret, on every row a read answers. */
const strip: ApiMiddleware = async (call, _context, next) =>
  [await next(call)]
    .flat()
    .filter(isRecord)
    .map(({ accessToken, ...rest }) => ({ ...rest, hasAccessToken: !!accessToken }));

describe('createApi', () => {
  let mockQuerier: MockedQuerier;
  let pool: QuerierPool;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuerier = createMockQuerier();
    pool = createMockQuerierPool(new PostgresDialect(), async () => mockQuerier);
  });

  /** The id is one value, which a composite key has no spelling for on either side yet. */
  it('should refuse a call by id on a composite key, naming the API', async () => {
    const Enrolment = defineEntity({
      name: 'Enrolment',
      fields: { studentId: f.number().id(), courseId: f.string().id() },
    });
    const api = createApi({ include: [Enrolment], pool });

    await expect(api.call({ entity: 'enrolment', op: 'findOneById', id: '1' }, undefined)).rejects.toThrow(
      /composite primary key \(studentId, courseId\), which the API does not support/,
    );
  });

  it('should refuse a call by id naming no id', async () => {
    const api = createApi({ include: [User], pool });

    await expect(api.call({ entity: 'user', op: 'findOneById' }, undefined)).rejects.toThrow(
      "'findOneById' names the row it addresses in 'id'",
    );
  });

  it('should pick the pool per call, after the context it resolved', async () => {
    const tenantQuerier = createMockQuerier();
    const seen: unknown[] = [];
    const api = createApi<{ tenantId: number }>({
      include: [User],
      contextOf: (context) => ({ tenantId: context.tenantId }),
      pool: (context, appContext) => {
        seen.push([context.tenantId, appContext['tenantId']]);
        return createMockQuerierPool(new PostgresDialect(), async () => tenantQuerier);
      },
    });

    await api.call({ entity: 'user', op: 'findMany' }, { tenantId: 7 });

    expect(seen).toEqual([[7, 7]]);
    expect(tenantQuerier.findMany).toHaveBeenCalled();
  });

  it('should refuse an API naming no entity to serve', () => {
    const refusal = "name the entities the API serves in 'include'";
    expect(() => createApi({ pool, include: [] })).toThrow(refusal);
    // @ts-expect-error: an untyped caller can still leave it out
    expect(() => createApi({ pool })).toThrow(refusal);
  });

  // The path comes from the class name, so two entities on the same table in different schemas would
  // land on one path, the second unreachable.
  it('should throw when two entities claim the same path', () => {
    const Company = defineEntity({ name: 'Company', schema: 'crm', fields: { id: f.number().autoIncrement() } });
    const Shadow = defineEntity({ name: 'Company', schema: 'billing', fields: { id: f.number().autoIncrement() } });

    expect(() => createApi({ pool, include: [Company, Shadow] })).toThrow(
      '/company <- Company (crm.Company), Company (billing.Company)',
    );

    // Which is what `entityPath` is for: the two are one table in two schemas, so the schema tells them apart.
    const api = createApi({
      pool,
      include: [Company, serve(Shadow, {})],
      entityPath: (entity) => `${getMeta(entity).schema}-company`,
    });
    expect(api.serves('crm-company', 'findMany')).toBe(true);
    expect(api.serves('billing-company', 'findMany')).toBe(true);
  });

  it('should name a colliding table by itself when it has no schema', () => {
    @Entity()
    class Order {
      @Field(f.number().autoIncrement()) id?: number;
    }
    const Archived =
      @Entity({ name: 'order_archive' })
      class Order {
        @Field(f.number().autoIncrement()) id?: number;
      };

    expect(() => createApi({ pool, include: [Order, Archived] })).toThrow(
      '/order <- Order (Order), Order (order_archive)',
    );
  });

  it('should serve no entity it does not name, however defined', async () => {
    defineEntity({ name: 'OtherEntity', fields: { id: f.number().autoIncrement() } });
    const api = createApi({ pool, include: [User] });

    expect(api.serves('other-entity', 'findMany')).toBe(false);
    await expect(api.call({ entity: 'other-entity', op: 'findMany' }, undefined)).rejects.toMatchObject({
      message: "'other-entity' is not an entity this API serves",
      status: 404,
    });
  });

  it('should find one row, releasing the querier', async () => {
    mockQuerier.findOne.mockResolvedValue({ id: 1, name: 'John' });
    const api = createApi({ pool, include: [User] });

    const found = await api.call({ entity: 'user', op: 'findOne', query: { $where: { name: 'John' } } }, undefined);

    expect(found).toEqual({ id: 1, name: 'John' });
    expect(mockQuerier.findOne).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { name: 'John' } }));
    expect(mockQuerier.release).toHaveBeenCalled();
  });

  it('should wire contextOf into the ambient context for the whole call', async () => {
    let seen: unknown;
    mockQuerier.findOne.mockImplementation(async () => {
      seen = getContext();
      return { id: 1 };
    });
    const api = createApi<{ tid: number }>({ pool, include: [User], contextOf: (ctx) => ({ tenantId: ctx.tid }) });

    await api.call({ entity: 'user', op: 'findOne' }, { tid: 7 });

    expect(seen).toEqual({ tenantId: 7 });
  });

  /** An anonymous request: `contextOf` resolves nothing, and the call runs in an empty context, not its caller's. */
  it('should run in an empty context where contextOf resolves none', async () => {
    let seen: unknown;
    mockQuerier.findMany.mockImplementation(async () => {
      seen = getContext();
      return [];
    });
    const api = createApi({ pool, include: [User], contextOf: () => undefined });

    await withContext({ tenantId: 5 }, () => api.call({ entity: 'user', op: 'findMany' }, undefined));

    expect(seen).toEqual({});
  });

  /** A tRPC middleware sets the tenant, and the API, naming no `contextOf` of its own, runs inside it. */
  it("should keep the caller's context where it derives none", async () => {
    let seen: unknown;
    mockQuerier.findMany.mockImplementation(async () => {
      seen = getContext();
      return [];
    });
    const api = createApi({ pool, include: [User] });

    await withContext({ tenantId: 5 }, () => api.call({ entity: 'user', op: 'findMany' }, undefined));

    expect(seen).toEqual({ tenantId: 5 });
  });

  it('should check a call it is handed unchecked', async () => {
    const api = createApi({ pool, include: [User] });

    await expect(api.call({ entity: 'user', op: 'aggregate' }, undefined)).rejects.toThrow(
      "'aggregate' is not an operation the API serves",
    );
    await expect(api.call('findMany', undefined)).rejects.toThrow('a call must be a JSON object');
  });

  it('should count rows, honoring the cap the client sends', async () => {
    mockQuerier.count.mockResolvedValue(1);
    const api = createApi({ pool, include: [User] });

    expect(await api.call({ entity: 'user', op: 'count', query: { $limit: 1 } }, undefined)).toBe(1);
    expect(mockQuerier.count).toHaveBeenCalledWith(User, expect.objectContaining({ $limit: 1 }));
  });

  it('should find one row by id, merging the filter it carries', async () => {
    mockQuerier.findOne.mockResolvedValue({ id: 123 });
    const api = createApi({ pool, include: [User] });

    await api.call({ entity: 'user', op: 'findOneById', id: '123', query: { $where: { name: 'John' } } }, undefined);

    expect(mockQuerier.findOne).toHaveBeenCalledWith(
      User,
      expect.objectContaining({ $where: { id: '123', name: 'John' } }),
    );
  });

  /** The querier's own read-and-count, whose count is every matching row: `count` counts the page a `$limit` takes. */
  it('should find rows with the count of every one matching', async () => {
    mockQuerier.findManyAndCount.mockResolvedValue([[{ id: 1 }], 6]);
    const api = createApi({ pool, include: [User] });

    expect(await api.call({ entity: 'user', op: 'findManyAndCount', query: { $limit: 1 } }, undefined)).toEqual([
      [{ id: 1 }],
      6,
    ]);
    expect(mockQuerier.count).not.toHaveBeenCalled();
  });

  it('should read a page past the cursor the call carries', async () => {
    const page = { items: [{ id: 1 }], endCursor: 'b', hasNextPage: true, hasPrevPage: true };
    mockQuerier.findManyPage.mockResolvedValue(page);
    const api = createApi({ pool, include: [User] });

    expect(
      await api.call({ entity: 'user', op: 'findManyPage', query: { $limit: 1, $after: 'a' } }, undefined),
    ).toEqual(page);
    expect(mockQuerier.findManyPage).toHaveBeenCalledWith(User, { $where: {}, $limit: 1, $after: 'a' });
  });

  it('should refuse a page that names no size', async () => {
    const api = createApi({ pool, include: [User] });

    await expect(api.call({ entity: 'user', op: 'findManyPage' }, undefined)).rejects.toMatchObject({
      message: "a page of 'User' holds a positive whole number of rows, and $limit is undefined",
      path: ['query', '$limit'],
    });
    expect(mockQuerier.findManyPage).not.toHaveBeenCalled();
  });

  it('should insert one row in a transaction', async () => {
    mockQuerier.insertOne.mockResolvedValue(1);
    const api = createApi({ pool, include: [User] });

    expect(await api.call({ entity: 'user', op: 'insertOne', payload: { name: 'John' } }, undefined)).toBe(1);
    expect(mockQuerier.transaction).toHaveBeenCalled();
    expect(mockQuerier.insertOne).toHaveBeenCalledWith(User, { name: 'John' });
    expect(mockQuerier.release).toHaveBeenCalled();
  });

  it('should insert and save rows', async () => {
    mockQuerier.insertMany.mockResolvedValue([1, 2]);
    mockQuerier.saveMany.mockResolvedValue([1, 2]);
    const api = createApi({ pool, include: [User] });
    const rows = [{ name: 'a' }, { name: 'b' }];

    expect(await api.call({ entity: 'user', op: 'insertMany', payload: rows }, undefined)).toEqual([1, 2]);
    expect(await api.call({ entity: 'user', op: 'saveMany', payload: rows }, undefined)).toEqual([1, 2]);
    expect(mockQuerier.insertMany).toHaveBeenCalledWith(User, rows);
  });

  /** A payload of the wrong shape is the client's mistake, refused before any write as a malformed query is. */
  it.each([
    { what: 'rows, with none', op: 'insertMany', payload: undefined, message: 'a JSON array of rows' },
    { what: 'rows, with one row', op: 'insertMany', payload: { name: 'a' }, message: 'a JSON array of rows' },
    { what: 'one row, with rows', op: 'insertOne', payload: [{ name: 'a' }], message: 'a JSON object' },
    { what: 'an update, with none', op: 'updateMany', payload: undefined, message: 'a JSON object' },
  ] as const)('should refuse a write of $what', async ({ op, payload, message }) => {
    const api = createApi({ pool, include: [User] });

    await expect(api.call({ entity: 'user', op, payload }, undefined)).rejects.toThrow(message);
    expect(mockQuerier.insertMany).not.toHaveBeenCalled();
    expect(mockQuerier.insertOne).not.toHaveBeenCalled();
  });

  it('should save one row', async () => {
    mockQuerier.saveOne.mockResolvedValue(1);
    const api = createApi({ pool, include: [User] });

    expect(await api.call({ entity: 'user', op: 'saveOne', payload: { id: 1, name: 'John' } }, undefined)).toBe(1);
    expect(mockQuerier.saveOne).toHaveBeenCalledWith(User, { id: 1, name: 'John' });
  });

  it('should update one row by id, and the rows a query matches', async () => {
    mockQuerier.updateMany.mockResolvedValue(3);
    const api = createApi({ pool, include: [User] });

    expect(await api.call({ entity: 'user', op: 'updateOneById', id: '1', payload: { name: 'J' } }, undefined)).toBe(3);
    expect(mockQuerier.updateMany).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { id: '1' } }), {
      name: 'J',
    });
    await api.call(
      { entity: 'user', op: 'updateMany', query: { $where: { status: 1 } }, payload: { status: 2 } },
      undefined,
    );
    expect(mockQuerier.updateMany).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { status: 1 } }), {
      status: 2,
    });
  });

  it('should delete softly by default, and for good where the call says so', async () => {
    mockQuerier.deleteMany.mockResolvedValue(1);
    const api = createApi({ pool, include: [User] });

    expect(await api.call({ entity: 'user', op: 'deleteOneById', id: '1', hardDelete: true }, undefined)).toBe(1);
    expect(mockQuerier.deleteMany).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { id: '1' } }), {
      hardDelete: true,
    });
    await api.call({ entity: 'user', op: 'deleteMany', query: { $where: { status: 1 } } }, undefined);
    expect(mockQuerier.deleteMany).toHaveBeenLastCalledWith(User, expect.objectContaining({ $where: { status: 1 } }), {
      hardDelete: false,
    });
  });

  it('should release and propagate the error of a write in its transaction', async () => {
    mockQuerier.insertOne.mockRejectedValue(new Error('Insert error'));
    const api = createApi({ pool, include: [User] });

    await expect(api.call({ entity: 'user', op: 'insertOne', payload: {} }, undefined)).rejects.toThrow('Insert error');
    expect(mockQuerier.transaction).toHaveBeenCalled();
    expect(mockQuerier.release).toHaveBeenCalled();
  });

  describe('exposure', () => {
    it('should refuse a relation reaching an entity it does not serve, before any query', async () => {
      const api = createApi({ include: [Item, Tax], pool });

      await expect(
        api.call({ entity: 'item', op: 'findMany', query: { $populate: { tags: true } } }, undefined),
      ).rejects.toThrow("'tags' reaches 'Tag', which this API does not serve");
      expect(mockQuerier.findMany).not.toHaveBeenCalled();
    });

    it('should leave out what is not readable, and refuse what is not writable', async () => {
      const api = createApi({ include: [serve(User, { members: { password: ['insert'] } })], pool });

      await api.call({ entity: 'user', op: 'findMany' }, undefined);
      expect(mockQuerier.findMany).toHaveBeenCalledWith(
        User,
        expect.objectContaining({ $select: { password: false } }),
      );
      await expect(
        api.call(
          { entity: 'user', op: 'updateMany', query: { $where: { id: '1' } }, payload: { password: 'x' } },
          undefined,
        ),
      ).rejects.toThrow("'password' cannot be updated through this API");
    });

    it("should leave a middleware's own relations alone: the server writes those", async () => {
      const populate: ApiMiddleware = (call, _context, next) =>
        next({ ...call, query: { ...call.query, $populate: Object.assign({}, call.query.$populate, { tags: true }) } });
      const api = createApi({ include: [Item], pool, use: [populate] });

      await api.call({ entity: 'item', op: 'findMany' }, undefined);

      expect(mockQuerier.findMany).toHaveBeenCalledWith(Item, expect.objectContaining({ $populate: { tags: true } }));
    });
  });

  describe('middleware', () => {
    it('should run each around the call, first to last, seeing the op and the entity', async () => {
      mockQuerier.findMany.mockResolvedValue([]);
      const order: string[] = [];
      const named =
        (name: string): ApiMiddleware =>
        async (call, _context, next) => {
          order.push(`${name}:${call.op}:${call.entity.name}`);
          const result = await next(call);
          order.push(`${name}:done`);
          return result;
        };
      const api = createApi({ pool, include: [User], use: [named('a'), named('b')] });

      await api.call({ entity: 'user', op: 'findMany' }, undefined);

      expect(order).toEqual(['a:findMany:User', 'b:findMany:User', 'b:done', 'a:done']);
    });

    it("should run an entity's own middleware, typed by it, on its calls alone, after the API's", async () => {
      mockQuerier.insertOne.mockResolvedValue(1);
      const order: string[] = [];
      const logged: ApiMiddleware<Scope> = (call, _context, next) => {
        order.push(`api:${call.entity.name}`);
        return next(call);
      };
      const api = createApi({
        pool,
        include: [serve(User, { use: [scopedToCompany] }), Item],
        use: [logged],
      });

      await api.call({ entity: 'user', op: 'findMany' }, { companyId: '40' });
      await api.call({ entity: 'user', op: 'insertOne', payload: { name: 'a' } }, { companyId: '40' });
      await api.call({ entity: 'item', op: 'findMany' }, { companyId: '40' });

      expect(order).toEqual(['api:User', 'api:User', 'api:Item']);
      expect(mockQuerier.findMany).toHaveBeenCalledWith(User, expect.objectContaining({ $where: { companyId: '40' } }));
      expect(mockQuerier.insertOne).toHaveBeenCalledWith(User, { name: 'a', companyId: '40' });
      expect(mockQuerier.findMany).toHaveBeenLastCalledWith(Item, expect.objectContaining({ $where: {} }));
    });

    it('should refuse a middleware moving a call to another entity', async () => {
      // @ts-expect-error: a middleware hands on a call to the entity it was given, which an untyped one may not
      const moved: ApiMiddleware = (call, _context, next) => next({ ...call, entity: Item });
      const api = createApi({ pool, include: [User, Item], use: [moved] });

      await expect(api.call({ entity: 'user', op: 'findMany' }, undefined)).rejects.toThrow(
        "a middleware moved a call to 'User' to another entity",
      );
    });

    it('should let a middleware reshape the result, which it sees as the entity holds it', async () => {
      mockQuerier.findMany.mockResolvedValue([{ id: 1, name: 'slack', accessToken: 'secret' }]);
      const api = createApi({ pool, include: [User], use: [strip] });

      expect(await api.call({ entity: 'user', op: 'findMany' }, undefined)).toEqual([
        { id: 1, name: 'slack', hasAccessToken: true },
      ]);
    });

    it('should abort before touching the pool when a middleware throws', async () => {
      const err = new UqlRequestError('forbidden', 403);
      const refuse: ApiMiddleware = async () => {
        throw err;
      };
      const api = createApi({ pool, include: [User], use: [refuse] });

      await expect(api.call({ entity: 'user', op: 'findMany' }, undefined)).rejects.toBe(err);
      expect(mockQuerier.findMany).not.toHaveBeenCalled();
    });
  });
});
