import { User } from '../test';
import { Querier, Repository } from '../type';
import { BaseRepository } from './baseRepository';

describe('repository', () => {
  let repository: Repository<User>;
  let querier: Partial<Querier>;

  beforeEach(() => {
    querier = {
      count: jest.fn(),
      findOneById: jest.fn(),
      findOne: jest.fn(),
      findMany: jest.fn(),
      findManyAndCount: jest.fn(),
      insertOne: jest.fn(),
      insertMany: jest.fn(),
      updateOneById: jest.fn(),
      updateMany: jest.fn(),
      deleteOneById: jest.fn(),
      deleteMany: jest.fn(),
    };
    repository = new BaseRepository(User, querier as Querier);
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
});
