import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    vi.spyOn(http, 'remove').mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('findOneById', async () => {
    await querier.findOneById(User, 1);
    expect(http.get).toHaveBeenCalledWith('/api/user/1', undefined);

    await querier.findOneById(User, 1, { $select: { name: true } });
    expect(http.get).toHaveBeenCalledWith('/api/user/1?$select={"name":true}', undefined);
  });

  it('findOne', async () => {
    await querier.findOne(User, { $where: { name: 'Mario' } });
    expect(http.get).toHaveBeenCalledWith('/api/user/one?$where={"name":"Mario"}', undefined);
  });

  it('findMany', async () => {
    await querier.findMany(User, { $where: { name: 'Mario' } });
    expect(http.get).toHaveBeenCalledWith('/api/user?$where={"name":"Mario"}', undefined);
  });

  it('findManyAndCount', async () => {
    await querier.findManyAndCount(User, { $where: { name: 'Mario' } });
    expect(http.get).toHaveBeenCalledWith('/api/user?$where={"name":"Mario"}&count=true', { count: true });
  });

  it('count', async () => {
    await querier.count(User, { $where: { name: 'Mario' } });
    expect(http.get).toHaveBeenCalledWith('/api/user/count?$where={"name":"Mario"}', undefined);
  });

  it('insertOne', async () => {
    await querier.insertOne(User, { name: 'Mario' });
    expect(http.post).toHaveBeenCalledWith('/api/user', { name: 'Mario' }, undefined);
  });

  it('updateOneById', async () => {
    await querier.updateOneById(User, 1, { name: 'Mario' });
    expect(http.patch).toHaveBeenCalledWith('/api/user/1', { name: 'Mario' }, undefined);
  });

  it('saveOne insert', async () => {
    await querier.saveOne(User, { name: 'Mario' });
    expect(http.post).toHaveBeenCalledWith('/api/user', { name: 'Mario' }, undefined);
  });

  it('saveOne update', async () => {
    await querier.saveOne(User, { id: 1, name: 'Mario' });
    expect(http.patch).toHaveBeenCalledWith('/api/user/1', { id: 1, name: 'Mario' }, undefined);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('deleteOneById', async () => {
    await querier.deleteOneById(User, 1);
    expect(http.remove).toHaveBeenCalledWith('/api/user/1', {});

    await querier.deleteOneById(User, 1, { softDelete: true });
    expect(http.remove).toHaveBeenCalledWith('/api/user/1?softDelete=true', { softDelete: true });
  });

  it('deleteMany', async () => {
    await querier.deleteMany(User, { $where: { name: 'Mario' } });
    expect(http.remove).toHaveBeenCalledWith('/api/user?$where={"name":"Mario"}', {});

    await querier.deleteMany(User, { $where: { name: 'Mario' } }, { softDelete: true });
    expect(http.remove).toHaveBeenCalledWith('/api/user?$where={"name":"Mario"}&softDelete=true', { softDelete: true });
  });
});
