import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { stringifyQuery } from '../../http/query.js';
import { User, VectorItem } from '../../test/index.js';
import * as http from '../http/index.js';
import { HttpQuerier } from './httpQuerier.js';

describe('HttpQuerier', () => {
  let querier: HttpQuerier;

  beforeEach(() => {
    querier = new HttpQuerier('/api');
    vi.spyOn(http, 'get').mockResolvedValue({ data: {}, count: 0 });
    vi.spyOn(http, 'post').mockResolvedValue({ data: {} });
    vi.spyOn(http, 'patch').mockResolvedValue({ data: {} });
    vi.spyOn(http, 'put').mockResolvedValue({ data: {} });
    vi.spyOn(http, 'query').mockResolvedValue({ data: {}, count: 0 });
    vi.spyOn(http, 'remove').mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should address an entity by the path it is given, for a build that renames classes', async () => {
    const named = new HttpQuerier('/api', { entityPath: () => 'people' });
    await named.findMany(User, {});

    expect(vi.mocked(http.get).mock.calls[0]?.[0]).toBe('/api/people');
  });

  it('should read one row by id from its path, with the query in the string', async () => {
    await querier.findOneById(User, '1');
    expect(http.get).toHaveBeenCalledWith('/api/user/1', undefined);

    await querier.findOneById(User, '1', { $select: { name: true } });
    expect(http.get).toHaveBeenCalledWith(`/api/user/1${stringifyQuery({ $select: { name: true } })}`, undefined);
  });

  /** The route is one path segment, and `[object Object]` in it is a request no server can answer. */
  it('should refuse an id object, which the `/:id` route has no spelling for', async () => {
    // @ts-expect-error: `User` has a single key
    await expect(querier.findOneById(User, { id: 1 })).rejects.toThrow(
      /'User' was addressed by an id object, which the HTTP route cannot carry/,
    );
    expect(http.get).not.toHaveBeenCalled();
  });

  it('should read one row from the one path', async () => {
    await querier.findOne(User, { $where: { name: 'Mario' } });
    expect(http.get).toHaveBeenCalledWith(`/api/user/one${stringifyQuery({ $where: { name: 'Mario' } })}`, undefined);
  });

  it('should read rows from the entity path', async () => {
    await querier.findMany(User, { $where: { name: 'Mario' } });
    expect(http.get).toHaveBeenCalledWith(`/api/user${stringifyQuery({ $where: { name: 'Mario' } })}`, undefined);
  });

  it('should read rows and their count from the entity path', async () => {
    const response = await querier.findManyAndCount(User, { $where: { name: 'Mario' } });
    expect(http.get).toHaveBeenCalledWith(`/api/user${stringifyQuery({ $where: { name: 'Mario' }, count: true })}`, {
      count: true,
    });
    expectTypeOf(response.data).toEqualTypeOf<User[]>();
    expectTypeOf(response.count).toEqualTypeOf<number>();
  });

  it('should reject a count read whose response carries no count', async () => {
    vi.mocked(http.get).mockResolvedValueOnce({ data: [] });
    await expect(querier.findManyAndCount(User, {})).rejects.toThrow('findManyAndCount response has an invalid count');
  });

  it('should return plain entities for browser reads with a vector sort', async () => {
    const query = { $sort: { vec: { $vector: [1, 2, 3], $project: 'distance' } } } as const;

    const byId = await querier.findOneById(VectorItem, 1, query);
    const one = await querier.findOne(VectorItem, query);
    const many = await querier.findMany(VectorItem, query);
    const manyAndCount = await querier.findManyAndCount(VectorItem, query);

    expectTypeOf(byId.data).toEqualTypeOf<VectorItem | undefined>();
    expectTypeOf(one.data).toEqualTypeOf<VectorItem | undefined>();
    expectTypeOf(many.data).toEqualTypeOf<VectorItem[]>();
    expectTypeOf(manyAndCount.data).toEqualTypeOf<VectorItem[]>();
  });

  it('should count rows from the count path', async () => {
    await querier.count(User, { $where: { name: 'Mario' } });
    expect(http.get).toHaveBeenCalledWith(`/api/user/count${stringifyQuery({ $where: { name: 'Mario' } })}`, undefined);
  });

  /** No endpoint of its own: the `count` route capped at one row, mapped to a yes or no. */
  it('should tell whether anything matches', async () => {
    vi.mocked(http.get).mockResolvedValueOnce({ data: 1 });
    const res = await querier.exists(User, { $where: { name: 'Mario' } });
    expect(http.get).toHaveBeenCalledWith(
      `/api/user/count${stringifyQuery({ $where: { name: 'Mario' }, $limit: 1 })}`,
      undefined,
    );
    expect(res.data).toBe(true);
  });

  it('should report false where nothing matched', async () => {
    vi.mocked(http.get).mockResolvedValueOnce({ data: 0 });
    await expect(querier.exists(User, { $where: { name: 'nobody' } })).resolves.toMatchObject({ data: false });
  });

  it('should POST one row to the entity path', async () => {
    await querier.insertOne(User, { name: 'Mario' });
    expect(http.post).toHaveBeenCalledWith('/api/user', { name: 'Mario' }, undefined);
  });

  it('should POST rows to the many path', async () => {
    await querier.insertMany(User, [{ name: 'Mario' }, { name: 'Luigi' }]);
    expect(http.post).toHaveBeenCalledWith('/api/user/many', [{ name: 'Mario' }, { name: 'Luigi' }], undefined);
  });

  it('should PATCH one row by id', async () => {
    await querier.updateOneById(User, '1', { name: 'Mario' });
    expect(http.patch).toHaveBeenCalledWith('/api/user/1', { name: 'Mario' }, undefined);
  });

  it('should PATCH the rows a query matches', async () => {
    await querier.updateMany(User, { $where: { name: 'Mario' } }, { name: 'Luigi' });
    expect(http.patch).toHaveBeenCalledWith(
      `/api/user${stringifyQuery({ $where: { name: 'Mario' } })}`,
      { name: 'Luigi' },
      undefined,
    );
  });

  it('should PUT a saved row whether or not it carries an id, the server upserting', async () => {
    await querier.saveOne(User, { name: 'Mario' });
    expect(http.put).toHaveBeenCalledWith('/api/user', { name: 'Mario' }, undefined);

    await querier.saveOne(User, { id: '1', name: 'Mario' });
    expect(http.put).toHaveBeenCalledWith('/api/user', { id: '1', name: 'Mario' }, undefined);
    expect(http.post).not.toHaveBeenCalled();
    expect(http.patch).not.toHaveBeenCalled();
  });

  it('should PUT saved rows to the many path', async () => {
    await querier.saveMany(User, [{ id: '1' }, { name: 'new' }]);
    expect(http.put).toHaveBeenCalledWith('/api/user/many', [{ id: '1' }, { name: 'new' }], undefined);
  });

  it('should DELETE one row by id, hard where asked', async () => {
    await querier.deleteOneById(User, '1');
    expect(http.remove).toHaveBeenCalledWith('/api/user/1', {});

    await querier.deleteOneById(User, '1', { hardDelete: true });
    expect(http.remove).toHaveBeenCalledWith('/api/user/1?hardDelete=true', { hardDelete: true });
  });

  it('should DELETE the rows a query matches, hard where asked', async () => {
    await querier.deleteMany(User, { $where: { name: 'Mario' } });
    expect(http.remove).toHaveBeenCalledWith(`/api/user${stringifyQuery({ $where: { name: 'Mario' } })}`, {});

    await querier.deleteMany(User, { $where: { name: 'Mario' } }, { hardDelete: true });
    expect(http.remove).toHaveBeenCalledWith(
      `/api/user${stringifyQuery({ $where: { name: 'Mario' }, hardDelete: true })}`,
      { hardDelete: true },
    );
  });

  describe('readMethod QUERY (RFC 10008)', () => {
    it('should send reads via QUERY with the query object as body', async () => {
      const rfcQuerier = new HttpQuerier('/api', { readMethod: 'QUERY' });
      await rfcQuerier.findMany(User, { $where: { name: 'Mario' } });
      expect(http.query).toHaveBeenCalledWith('/api/user', { $where: { name: 'Mario' } }, undefined);
      await rfcQuerier.findOne(User, { $where: { name: 'Mario' } });
      expect(http.query).toHaveBeenCalledWith('/api/user/one', { $where: { name: 'Mario' } }, undefined);
      await rfcQuerier.count(User, { $where: { name: 'Mario' } });
      expect(http.query).toHaveBeenCalledWith('/api/user/count', { $where: { name: 'Mario' } }, undefined);
      await rfcQuerier.findManyAndCount(User, {});
      expect(http.query).toHaveBeenCalledWith('/api/user', { count: true }, expect.objectContaining({ count: true }));
      expect(http.get).not.toHaveBeenCalled();
    });

    it('should keep the canonical method of a write and of a read by id', async () => {
      const rfcQuerier = new HttpQuerier('/api', { readMethod: 'QUERY' });
      await rfcQuerier.findOneById(User, '1');
      expect(http.get).toHaveBeenCalledWith('/api/user/1', undefined);
      await rfcQuerier.insertOne(User, { name: 'Mario' });
      expect(http.post).toHaveBeenCalledWith('/api/user', { name: 'Mario' }, undefined);
      expect(http.query).not.toHaveBeenCalled();
    });
  });

  describe('headers', () => {
    it('should merge instance default headers into every request', async () => {
      const ssrQuerier = new HttpQuerier('/api', { headers: { authorization: 'Bearer abc' } });
      await ssrQuerier.findMany(User, {});
      expect(http.get).toHaveBeenCalledWith('/api/user', { headers: { authorization: 'Bearer abc' } });
    });

    it('should let per-call headers win over instance defaults', async () => {
      const ssrQuerier = new HttpQuerier('/api', { headers: { authorization: 'Bearer abc', 'x-a': '1' } });
      await ssrQuerier.insertOne(User, { name: 'Mario' }, { headers: { authorization: 'Bearer xyz' } });
      expect(http.post).toHaveBeenCalledWith(
        '/api/user',
        { name: 'Mario' },
        { headers: { authorization: 'Bearer xyz', 'x-a': '1' } },
      );
    });

    it('should send per-call headers without instance defaults', async () => {
      await querier.findOne(User, {}, { headers: { authorization: 'Bearer xyz' } });
      expect(http.get).toHaveBeenCalledWith('/api/user/one', { headers: { authorization: 'Bearer xyz' } });
    });
  });
});
