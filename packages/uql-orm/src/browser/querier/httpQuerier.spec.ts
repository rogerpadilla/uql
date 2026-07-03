import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stringifyQuery } from '../../http/query.js';
import { User } from '../../test/index.js';
import * as http from '../http/index.js';
import { HttpQuerier } from './httpQuerier.js';

describe('HttpQuerier', () => {
  let querier: HttpQuerier;

  beforeEach(() => {
    querier = new HttpQuerier('/api');
    vi.spyOn(http, 'get').mockResolvedValue({ data: {} });
    vi.spyOn(http, 'post').mockResolvedValue({ data: {} });
    vi.spyOn(http, 'patch').mockResolvedValue({ data: {} });
    vi.spyOn(http, 'put').mockResolvedValue({ data: {} });
    vi.spyOn(http, 'query').mockResolvedValue({ data: {} });
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
    await querier.findManyAndCount(User, { $where: { name: 'Mario' } });
    expect(http.get).toHaveBeenCalledWith(`/api/user${stringifyQuery({ $where: { name: 'Mario' }, count: true })}`, {
      count: true,
    });
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

    await querier.deleteOneById(User, 1, { softDelete: true });
    expect(http.remove).toHaveBeenCalledWith('/api/user/1?softDelete=true', { softDelete: true });
  });

  it('deleteMany', async () => {
    await querier.deleteMany(User, { $where: { name: 'Mario' } });
    expect(http.remove).toHaveBeenCalledWith(`/api/user${stringifyQuery({ $where: { name: 'Mario' } })}`, {});

    await querier.deleteMany(User, { $where: { name: 'Mario' } }, { softDelete: true });
    expect(http.remove).toHaveBeenCalledWith(
      `/api/user${stringifyQuery({ $where: { name: 'Mario' }, softDelete: true })}`,
      { softDelete: true },
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
