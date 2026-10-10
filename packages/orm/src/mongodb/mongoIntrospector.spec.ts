import { AbstractCursor, Collection, MongoClient, MongoServerError } from 'mongodb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockQuerier, createMockQuerierPool } from '../test/index.js';
import { UqlUsageError } from '../util/uqlError.js';
import { MongoDialect } from './mongoDialect.js';
import { MongoSchemaIntrospector } from './mongoIntrospector.js';
import { MongodbQuerierPool } from './mongodbQuerierPool.js';

/**
 * A pool over a client that never connects, answering that the collection exists and has no key-spec
 * indexes, and failing search indexes with `error`: every engine in the test databases has Atlas Search.
 */
function introspectorFailingSearchIndexes(error: Error): MongoSchemaIntrospector {
  vi.spyOn(MongoClient.prototype, 'connect').mockImplementation(function (this: MongoClient) {
    return Promise.resolve(this);
  });
  vi.spyOn(AbstractCursor.prototype, 'toArray')
    .mockResolvedValueOnce([{ name: 'items' }])
    .mockResolvedValueOnce([]);
  vi.spyOn(Collection.prototype, 'aggregate').mockImplementation(() => {
    throw error;
  });
  return new MongoSchemaIntrospector(new MongodbQuerierPool('mongodb://127.0.0.1:1'));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MongoSchemaIntrospector search indexes', () => {
  it('should read none from a server without Atlas Search', async () => {
    const introspector = introspectorFailingSearchIndexes(
      new MongoServerError({ message: 'SearchNotEnabled', code: 31082 }),
    );

    expect(await introspector.getTableSchema('items')).toEqual({ name: 'items', columns: [], indexes: [] });
  });

  it('should report any other failure', async () => {
    const introspector = introspectorFailingSearchIndexes(new MongoServerError({ message: 'Unauthorized', code: 13 }));

    await expect(introspector.getTableSchema('items')).rejects.toThrow('Unauthorized');
  });
});

describe('MongoSchemaIntrospector partial indexes', () => {
  it('should read a partial index filter as its predicate, and none for a full index', async () => {
    vi.spyOn(MongoClient.prototype, 'connect').mockImplementation(function (this: MongoClient) {
      return Promise.resolve(this);
    });
    vi.spyOn(AbstractCursor.prototype, 'toArray')
      .mockResolvedValueOnce([{ name: 'items', options: {} }])
      .mockResolvedValueOnce([
        { name: 'live_idx', key: { total: 1 }, partialFilterExpression: { live: true } },
        { name: 'full_idx', key: { total: 1 } },
      ]);
    vi.spyOn(Collection.prototype, 'aggregate').mockImplementation(() => {
      throw new MongoServerError({ message: 'SearchNotEnabled', code: 31082 });
    });
    const introspector = new MongoSchemaIntrospector(new MongodbQuerierPool('mongodb://127.0.0.1:1'));

    const schema = await introspector.getTableSchema('items');

    expect(schema?.indexes?.map(({ name, where }) => [name, where])).toEqual([
      ['live_idx', '{"live":true}'],
      ['full_idx', undefined],
    ]);
  });
});

describe('MongoSchemaIntrospector', () => {
  it('should refuse a pool whose querier is not MongoDB', async () => {
    const other = createMockQuerierPool(new MongoDialect(), async () => createMockQuerier());

    await expect(new MongoSchemaIntrospector(other).getTableNames()).rejects.toThrow(
      'MongoSchemaIntrospector requires a MongoDB querier',
    );
    await expect(new MongoSchemaIntrospector(other).getTableNames()).rejects.toThrow(UqlUsageError);
  });
});
