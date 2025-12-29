import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { MongoQuerier, QuerierPool } from '@uql/core/type';
import { MongoSchemaIntrospector } from './mongoIntrospector.js';

describe('MongoSchemaIntrospector', () => {
  let introspector: MongoSchemaIntrospector;
  let pool: QuerierPool;
  let querier: jest.Mocked<MongoQuerier>;
  let db: any;

  beforeEach(() => {
    db = {
      listCollections: jest.fn<any>().mockReturnValue({
        toArray: jest.fn<any>().mockResolvedValue([]),
      }),
      collection: jest.fn<any>().mockReturnValue({
        indexes: jest.fn<any>().mockResolvedValue([]),
      }),
    };

    querier = {
      db,
      release: jest.fn<any>().mockResolvedValue(undefined),
    } as any;

    pool = {
      getQuerier: jest.fn<any>().mockResolvedValue(querier),
    } as any;

    introspector = new MongoSchemaIntrospector(pool);
  });

  it('getTableNames should return collection names', async () => {
    db.listCollections.mockReturnValueOnce({
      toArray: jest.fn<any>().mockResolvedValue([{ name: 'users' }, { name: 'posts' }]),
    });

    const names = await introspector.getTableNames();

    expect(names).toEqual(['users', 'posts']);
  });

  it('getTableSchema should return collection details', async () => {
    db.listCollections.mockReturnValueOnce({
      toArray: jest.fn<any>().mockResolvedValue([{ name: 'users' }]),
    });
    db.collection.mockReturnValueOnce({
      indexes: jest.fn<any>().mockResolvedValue([
        { name: '_id_', key: { _id: 1 } },
        { name: 'idx_username', key: { username: 1 }, unique: true },
      ]),
    });

    const schema = await introspector.getTableSchema('users');

    expect(schema).toBeDefined();
    expect(schema?.name).toBe('users');
    expect(schema?.indexes).toHaveLength(2);
    expect(schema?.indexes?.[1]).toMatchObject({
      name: 'idx_username',
      columns: ['username'],
      unique: true,
    });
  });

  it('getTableSchema should return undefined for non-existent collection', async () => {
    db.listCollections.mockReturnValueOnce({
      toArray: jest.fn<any>().mockResolvedValue([]),
    });

    const schema = await introspector.getTableSchema('non_existent');

    expect(schema).toBeUndefined();
  });
});
