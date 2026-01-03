import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { User } from '../test/index.js';
import type { Querier, Repository } from '../type/index.js';
import { GenericRepository } from './genericRepository.js';

describe('repository', () => {
  let repository: Repository<User>;
  let querier: Record<keyof Querier, Mock>;

  beforeEach(() => {
    querier = {
      count: vi.fn(),
      findOneById: vi.fn(),
      findOne: vi.fn(),
      findMany: vi.fn(),
      findManyAndCount: vi.fn(),
      insertOne: vi.fn(),
      insertMany: vi.fn(),
      updateOneById: vi.fn(),
      updateMany: vi.fn(),
      saveOne: vi.fn(),
      saveMany: vi.fn(),
      deleteOneById: vi.fn(),
      deleteMany: vi.fn(),
      upsertOne: vi.fn(),
      getRepository: vi.fn(),
      hasOpenTransaction: undefined,
      transaction: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
    } as unknown as Record<keyof Querier, Mock>;
    repository = new GenericRepository(User, querier as unknown as Querier);
  });

  it('count', async () => {
    await repository.count({});
    expect(querier.count).toHaveBeenCalledWith(User, {});
  });

  it('findOneById', async () => {
    await repository.findOneById(1);
    expect(querier.findOneById).toHaveBeenCalledWith(User, 1, undefined);
  });

  it('findOne', async () => {
    await repository.findOne({});
    expect(querier.findOne).toHaveBeenCalledWith(User, {});
  });

  it('findMany', async () => {
    await repository.findMany({});
    expect(querier.findMany).toHaveBeenCalledWith(User, {});
  });

  it('findManyAndCount', async () => {
    await repository.findManyAndCount({});
    expect(querier.findManyAndCount).toHaveBeenCalledWith(User, {});
  });

  it('insertOne', async () => {
    await repository.insertOne({});
    expect(querier.insertOne).toHaveBeenCalledWith(User, {});
  });

  it('insertMany', async () => {
    await repository.insertMany([{}]);
    expect(querier.insertMany).toHaveBeenCalledWith(User, [{}]);
  });

  it('updateMany', async () => {
    await repository.updateMany({}, {});
    expect(querier.updateMany).toHaveBeenCalledWith(User, {}, {});
  });

  it('updateOneById', async () => {
    await repository.updateOneById(1, {});
    expect(querier.updateOneById).toHaveBeenCalledWith(User, 1, {});
  });

  it('saveOne', async () => {
    await repository.saveOne({});
    expect(querier.saveOne).toHaveBeenCalledWith(User, {});
  });

  it('insertMany', async () => {
    await repository.saveMany([{}]);
    expect(querier.saveMany).toHaveBeenCalledWith(User, [{}]);
  });

  it('deleteOneById', async () => {
    await repository.deleteOneById(1);
    expect(querier.deleteOneById).toHaveBeenCalledWith(User, 1, undefined);

    await repository.deleteOneById(1, { softDelete: false });
    expect(querier.deleteOneById).toHaveBeenCalledWith(User, 1, { softDelete: false });
  });

  it('deleteMany', async () => {
    await repository.deleteMany({});
    expect(querier.deleteMany).toHaveBeenCalledWith(User, {}, undefined);

    await repository.deleteMany({}, { softDelete: false });
    expect(querier.deleteMany).toHaveBeenCalledWith(User, {}, { softDelete: false });
  });

  it('repository property', () => {
    expect(repository.querier).toBe(querier);
  });
});
