import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoDialect } from '../../mongo/mongoDialect.js';
import { MongodbQuerierPool } from '../../mongo/mongodbQuerierPool.js';
import { indexColumns } from '../../schema/indexColumns.js';
import { assertDefined, createMockQuerier, createMockQuerierPool, provisioningTimeout } from '../../test/index.js';
import { MongoSchemaIntrospector } from './mongoIntrospector.js';

describe('MongoSchemaIntrospector', () => {
  let server: MongoMemoryServer;
  let pool: MongodbQuerierPool;
  let introspector: MongoSchemaIntrospector;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    pool = new MongodbQuerierPool(server.getUri('introspect'));
    introspector = new MongoSchemaIntrospector(pool);
    await pool.withQuerier(async ({ db }) => {
      await db.createCollection('user');
      await db.collection('user').createIndex({ email: 1 }, { unique: true, name: 'user_email_idx' });
      await db.collection('user').createIndex({ lastName: 1, email: -1 });
      await db.createCollection('user_view', { viewOn: 'user', pipeline: [] });
    });
  }, provisioningTimeout);

  afterAll(async () => {
    await pool.end();
    await server.stop();
  }, provisioningTimeout);

  it('should list the collections and not the views', async () => {
    expect(await introspector.getTableNames()).toEqual(['user']);
  });

  it('should tell a collection from a view or nothing', async () => {
    expect(await introspector.tableExists('user')).toBe(true);
    expect(await introspector.tableExists('user_view')).toBe(false);
    expect(await introspector.tableExists('missing')).toBe(false);
  });

  it("should read a collection's indexes, its key's among them", async () => {
    expect(await introspector.getTableSchema('user')).toEqual({
      name: 'user',
      columns: [],
      indexes: [
        { name: '_id_', entries: [{ column: '_id' }], unique: false },
        { name: 'user_email_idx', entries: [{ column: 'email' }], unique: true },
        { name: 'lastName_1_email_-1', entries: [{ column: 'lastName' }, { column: 'email' }], unique: false },
      ],
    });
  });

  it('should read no schema for a collection that does not exist', async () => {
    expect(await introspector.getTableSchema('missing')).toBeUndefined();
  });

  it('should build a table of the fields its indexes name, each one node', async () => {
    const table = (await introspector.introspect()).getTable('user');
    assertDefined(table);

    expect([...table.columns.keys()]).toEqual(['_id', 'email', 'lastName']);
    expect(table.indexes.map((index) => indexColumns(index).map((column) => column.name))).toEqual([
      ['_id'],
      ['email'],
      ['lastName', 'email'],
    ]);
    expect(indexColumns(table.indexes[2])[1]).toBe(table.columns.get('email'));
  });

  it('should leave out a named collection that does not exist', async () => {
    expect((await introspector.introspect(['missing'])).getTables()).toEqual([]);
  });

  it('should refuse a pool whose querier is not MongoDB', async () => {
    const other = createMockQuerierPool(new MongoDialect(), async () => createMockQuerier());

    await expect(new MongoSchemaIntrospector(other).getTableNames()).rejects.toThrow(
      'MongoSchemaIntrospector requires a MongoDB querier',
    );
  });
});
