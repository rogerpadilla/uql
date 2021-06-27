import { User } from '../test';
import { Querier, Repository } from '../type';
import { BaseRepository } from './baseRepository';

describe('repository', () => {
  let repository: Repository<User>;
  let querier: Partial<Querier>;

  beforeEach(() => {
    querier = {
      insertMany: jest.fn(),
      insertOne: jest.fn(),
      updateMany: jest.fn(),
      updateOneById: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      findOneById: jest.fn(),
      deleteMany: jest.fn(),
      deleteOneById: jest.fn(),
      count: jest.fn(),
    };
    repository = new BaseRepository(User, querier as Querier);
  });

  it('insertMany', async () => {
    await repository.insertMany([{}]);
    expect(querier.insertMany).toHaveBeenCalledWith(User, [{}]);
  });

  it('insertOne', async () => {
    await repository.insertOne({});
    expect(querier.insertOne).toHaveBeenCalledWith(User, {});
  });

  it('updateMany', async () => {
    await repository.updateMany({}, {});
    expect(querier.updateMany).toHaveBeenCalledWith(User, {}, {});
  });

  it('updateMany', async () => {
    await repository.updateOneById({}, 1);
    expect(querier.updateOneById).toHaveBeenCalledWith(User, {}, 1);
  });

  it('findMany', async () => {
    await repository.findMany({});
    expect(querier.findMany).toHaveBeenCalledWith(User, {});
  });

  it('findOne', async () => {
    await repository.findOne({});
    expect(querier.findOne).toHaveBeenCalledWith(User, {});
  });

  it('findOneById', async () => {
    await repository.findOneById(1);
    expect(querier.findOneById).toHaveBeenCalledWith(User, 1, undefined);
  });

  it('deleteMany', async () => {
    await repository.deleteMany({});
    expect(querier.deleteMany).toHaveBeenCalledWith(User, {}, undefined);

    await repository.deleteMany({}, { force: true });
    expect(querier.deleteMany).toHaveBeenCalledWith(User, {}, { force: true });
  });

  it('deleteOneById', async () => {
    await repository.deleteOneById(1);
    expect(querier.deleteOneById).toHaveBeenCalledWith(User, 1, undefined);

    await repository.deleteOneById(1, { force: true });
    expect(querier.deleteOneById).toHaveBeenCalledWith(User, 1, { force: true });
  });

  it('count', async () => {
    await repository.count({});
    expect(querier.count).toHaveBeenCalledWith(User, {});
  });
});
