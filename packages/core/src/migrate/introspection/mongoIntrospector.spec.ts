import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { MongoQuerier, QuerierPool } from '../../type/index.js';
import { MongoSchemaIntrospector } from './mongoIntrospector.js';

describe('MongoSchemaIntrospector', () => {
  let introspector: MongoSchemaIntrospector;
  let pool: QuerierPool;
  let querier: MongoQuerier;
  let db: {
    listCollections: Mock;
    collection: Mock;
  };

  beforeEach(() => {
    db = {
      listCollections: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
      collection: vi.fn().mockReturnValue({
        indexes: vi.fn().mockResolvedValue([]),
      }),
    };

    querier = {
      db,
      release: vi.fn().mockResolvedValue(undefined),
    } as unknown as MongoQuerier;

    pool = {
      getQuerier: vi.fn().mockResolvedValue(querier),
    } as unknown as QuerierPool;

    introspector = new MongoSchemaIntrospector(pool);
  });

  it('getTableNames should return collection names', async () => {
    db.listCollections.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([{ name: 'users' }, { name: 'posts' }]),
    });

    const names = await introspector.getTableNames();

    expect(names).toEqual(['users', 'posts']);
  });

  it('getTableSchema should return collection details', async () => {
    db.listCollections.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([{ name: 'users' }]),
    });
    db.collection.mockReturnValueOnce({
      indexes: vi.fn().mockResolvedValue([
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
      toArray: vi.fn().mockResolvedValue([]),
    });

    const schema = await introspector.getTableSchema('non_existent');

    expect(schema).toBeUndefined();
  });
});
