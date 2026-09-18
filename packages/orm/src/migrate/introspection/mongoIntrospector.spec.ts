import { AbstractCursor, Collection, MongoClient, MongoServerError } from 'mongodb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MongodbQuerierPool } from '../../mongo/mongodbQuerierPool.js';
import { MongoSchemaIntrospector } from './mongoIntrospector.js';

/**
 * A pool over a client that never connects, answering that the collection exists and has no key-spec
 * indexes, and failing search indexes with `error`: every engine in the test databases has Atlas Search.
 */
function introspectorFailingSearchIndexes(error: Error): MongoSchemaIntrospector {
  vi.spyOn(MongoClient.prototype, 'connect').mockImplementation(function (this: MongoClient) {
    return Promise.resolve(this);
  });
  vi.spyOn(AbstractCursor.prototype, 'toArray').mockResolvedValue([{ name: 'items' }]);
  vi.spyOn(Collection.prototype, 'indexes').mockResolvedValue([]);
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
