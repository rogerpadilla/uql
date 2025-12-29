import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { User } from '../../test/index.js';
import { GenericClientRepository } from './genericClientRepository.js';
import { HttpQuerier } from './httpQuerier.js';

describe('repository', () => {
  let repository: GenericClientRepository<User>;
  const querier = new HttpQuerier('');

  beforeEach(() => {
    globalThis.fetch = jest.fn() as any;
    (globalThis.fetch as jest.Mock).mockImplementation(setupFetchStub({}));
    repository = new GenericClientRepository(User, querier);
  });

  afterEach(() => {
    delete globalThis.fetch;
  });

  it('count', async () => {
    await repository.count({});
    expect(globalThis.fetch).toHaveBeenCalledWith('/user/count', expect.objectContaining({ method: 'get' }));
  });

  it('findOneById', async () => {
    await repository.findOneById(1);
    expect(globalThis.fetch).toHaveBeenCalledWith('/user/1', expect.objectContaining({ method: 'get' }));
  });

  it('findOne', async () => {
    await repository.findOne({});
    expect(globalThis.fetch).toHaveBeenCalledWith('/user/one', expect.objectContaining({ method: 'get' }));
  });

  it('findMany', async () => {
    await repository.findMany({});
    expect(globalThis.fetch).toHaveBeenCalledWith('/user', expect.objectContaining({ method: 'get' }));
  });

  it('findManyAndCount', async () => {
    await repository.findManyAndCount({});
    expect(globalThis.fetch).toHaveBeenCalledWith('/user?count=true', expect.objectContaining({ method: 'get' }));
  });

  it('insertOne', async () => {
    await repository.insertOne({});
    expect(globalThis.fetch).toHaveBeenCalledWith('/user', expect.objectContaining({ method: 'post' }));
  });

  it('updateOneById', async () => {
    await repository.updateOneById(1, {});
    expect(globalThis.fetch).toHaveBeenCalledWith('/user/1', expect.objectContaining({ method: 'patch' }));
  });

  it('saveOne', async () => {
    await repository.saveOne({});
    expect(globalThis.fetch).toHaveBeenCalledWith('/user', expect.objectContaining({ method: 'post' }));
  });

  it('saveOne id', async () => {
    await repository.saveOne({ id: 2 });
    expect(globalThis.fetch).toHaveBeenCalledWith('/user/2', expect.objectContaining({ method: 'patch' }));
  });

  it('deleteOneById', async () => {
    await repository.deleteOneById(1);
    expect(globalThis.fetch).toHaveBeenCalledWith('/user/1', expect.objectContaining({ method: 'delete' }));
  });

  it('deleteOneById soft', async () => {
    await repository.deleteOneById(1, { softDelete: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/user/1?softDelete=true',
      expect.objectContaining({ method: 'delete' }),
    );
  });

  it('deleteMany', async () => {
    await repository.deleteMany({});
    expect(globalThis.fetch).toHaveBeenCalledWith('/user', expect.objectContaining({ method: 'delete' }));
  });

  it('deleteMany soft', async () => {
    await repository.deleteMany({}, { softDelete: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/user?softDelete=true',
      expect.objectContaining({ method: 'delete' }),
    );
  });

  it('entity property', () => {
    expect(repository.entity).toBe(User);
  });

  it('repository property', () => {
    expect(repository.querier).toBe(querier);
  });
});

function setupFetchStub(data: object) {
  return async (_url: any) => ({
    status: 200,
    json: async () => ({ data }),
  });
}
