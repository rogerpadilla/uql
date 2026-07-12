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

  it('findOneById', async () => {
    await querier.findOneById(User, 1);
    expect(http.get).toHaveBeenCalledWith('/api/user/1', undefined);

    await querier.findOneById(User, 1, { $select: { name: true } });
    expect(http.get).toHaveBeenCalledWith(`/api/user/1${stringifyQuery({ $select: { name: true } })}`, undefined);
  });

  it('findOne', async () => {
    await querier.findOne(User, { $where: { name: 'Mario' } });
    expect(http.get).toHaveBeenCalledWith(`/api/user/one${stringifyQuery({ $where: { name: 'Mario' } })}`, undefined);
  });

  it('findMany', async () => {
    await querier.findMany(User, { $where: { name: 'Mario' } });
    expect(http.get).toHaveBeenCalledWith(`/api/user${stringifyQuery({ $where: { name: 'Mario' } })}`, undefined);
  });

  it('findManyAndCount', async () => {
    const response = await querier.findManyAndCount(User, { $where: { name: 'Mario' } });
    expect(http.get).toHaveBeenCalledWith(`/api/user${stringifyQuery({ $where: { name: 'Mario' }, count: true })}`, {
      count: true,
    });
    expectTypeOf(response.data).toEqualTypeOf<User[]>();
    expectTypeOf(response.count).toEqualTypeOf<number>();
  });

  it('findManyAndCount rejects a response without count metadata', async () => {
    vi.mocked(http.get).mockResolvedValueOnce({ data: [] });
    await expect(querier.findManyAndCount(User, {})).rejects.toThrow('findManyAndCount response has an invalid count');
  });

  it('infers projected distance fields for browser reads', async () => {
    const query = { $sort: { vec: { $vector: [1, 2, 3], $project: 'distance' } } } as const;

    const byId = await querier.findOneById(VectorItem, 1, query);
    const one = await querier.findOne(VectorItem, query);
    const many = await querier.findMany(VectorItem, query);
    const manyAndCount = await querier.findManyAndCount(VectorItem, query);

    expectTypeOf(byId.data).toEqualTypeOf<(VectorItem & { distance: number }) | undefined>();
    expectTypeOf(one.data).toEqualTypeOf<(VectorItem & { distance: number }) | undefined>();
    expectTypeOf(many.data).toEqualTypeOf<(VectorItem & { distance: number })[]>();
    expectTypeOf(manyAndCount.data).toEqualTypeOf<(VectorItem & { distance: number })[]>();
  });

  it('count', async () => {
    await querier.count(User, { $where: { name: 'Mario' } });
    expect(http.get).toHaveBeenCalledWith(`/api/user/count${stringifyQuery({ $where: { name: 'Mario' } })}`, undefined);
  });

  it('insertOne', async () => {
    await querier.insertOne(User, { name: 'Mario' });
    expect(http.post).toHaveBeenCalledWith('/api/user', { name: 'Mario' }, undefined);
  });

  it('insertMany', async () => {
    await querier.insertMany(User, [{ name: 'Mario' }, { name: 'Luigi' }]);
    expect(http.post).toHaveBeenCalledWith('/api/user/many', [{ name: 'Mario' }, { name: 'Luigi' }], undefined);
  });

  it('updateOneById', async () => {
    await querier.updateOneById(User, 1, { name: 'Mario' });
    expect(http.patch).toHaveBeenCalledWith('/api/user/1', { name: 'Mario' }, undefined);
  });

  it('updateMany', async () => {
    await querier.updateMany(User, { $where: { name: 'Mario' } }, { name: 'Luigi' });
    expect(http.patch).toHaveBeenCalledWith(
      `/api/user${stringifyQuery({ $where: { name: 'Mario' } })}`,
      { name: 'Luigi' },
      undefined,
    );
  });

  it('saveOne issues PUT regardless of id presence (server-side upsert)', async () => {
    await querier.saveOne(User, { name: 'Mario' });
    expect(http.put).toHaveBeenCalledWith('/api/user', { name: 'Mario' }, undefined);

    await querier.saveOne(User, { id: 1, name: 'Mario' });
    expect(http.put).toHaveBeenCalledWith('/api/user', { id: 1, name: 'Mario' }, undefined);
    expect(http.post).not.toHaveBeenCalled();
    expect(http.patch).not.toHaveBeenCalled();
  });

  it('saveMany', async () => {
    await querier.saveMany(User, [{ id: 1 }, { name: 'new' }]);
    expect(http.put).toHaveBeenCalledWith('/api/user/many', [{ id: 1 }, { name: 'new' }], undefined);
  });

  it('deleteOneById', async () => {
    await querier.deleteOneById(User, 1);
    expect(http.remove).toHaveBeenCalledWith('/api/user/1', {});

    await querier.deleteOneById(User, 1, { hardDelete: true });
    expect(http.remove).toHaveBeenCalledWith('/api/user/1?hardDelete=true', { hardDelete: true });
  });

  it('deleteMany', async () => {
    await querier.deleteMany(User, { $where: { name: 'Mario' } });
    expect(http.remove).toHaveBeenCalledWith(`/api/user${stringifyQuery({ $where: { name: 'Mario' } })}`, {});

    await querier.deleteMany(User, { $where: { name: 'Mario' } }, { hardDelete: true });
    expect(http.remove).toHaveBeenCalledWith(
      `/api/user${stringifyQuery({ $where: { name: 'Mario' }, hardDelete: true })}`,
      { hardDelete: true },
    );
  });

  describe('readMethod QUERY (RFC 10008)', () => {
    it('sends reads via QUERY with the query object as body', async () => {
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

    it('writes and byId reads keep their canonical methods', async () => {
      const rfcQuerier = new HttpQuerier('/api', { readMethod: 'QUERY' });
      await rfcQuerier.findOneById(User, 1);
      expect(http.get).toHaveBeenCalledWith('/api/user/1', undefined);
      await rfcQuerier.insertOne(User, { name: 'Mario' });
      expect(http.post).toHaveBeenCalledWith('/api/user', { name: 'Mario' }, undefined);
      expect(http.query).not.toHaveBeenCalled();
    });
  });

  describe('headers', () => {
    it('merges instance default headers into every request', async () => {
      const ssrQuerier = new HttpQuerier('/api', { headers: { authorization: 'Bearer abc' } });
      await ssrQuerier.findMany(User, {});
      expect(http.get).toHaveBeenCalledWith('/api/user', { headers: { authorization: 'Bearer abc' } });
    });

    it('per-call headers win over instance defaults', async () => {
      const ssrQuerier = new HttpQuerier('/api', { headers: { authorization: 'Bearer abc', 'x-a': '1' } });
      await ssrQuerier.insertOne(User, { name: 'Mario' }, { headers: { authorization: 'Bearer xyz' } });
      expect(http.post).toHaveBeenCalledWith(
        '/api/user',
        { name: 'Mario' },
        { headers: { authorization: 'Bearer xyz', 'x-a': '1' } },
      );
    });

    it('per-call headers work without instance defaults', async () => {
      await querier.findOne(User, {}, { headers: { authorization: 'Bearer xyz' } });
      expect(http.get).toHaveBeenCalledWith('/api/user/one', { headers: { authorization: 'Bearer xyz' } });
    });
  });
});
