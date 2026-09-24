import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoDialect } from '../../mongo/mongoDialect.js';
import { MongodbQuerierPool } from '../../mongo/mongodbQuerierPool.js';
import { indexColumns } from '../../schema/indexColumns.js';
import {
  assertDefined,
  createMockQuerier,
  createMockQuerierPool,
  mongoUri,
  provisioningTimeout,
} from '../../test/index.js';
import { UqlUsageError } from '../../util/uqlError.js';
import { MongoSchemaIntrospector } from './mongoIntrospector.js';

describe('MongoSchemaIntrospector', () => {
  const pool = new MongodbQuerierPool(mongoUri('uql_introspect'));
  const introspector = new MongoSchemaIntrospector(pool);

  beforeAll(async () => {
    await pool.withQuerier(async ({ db }) => {
      await db.dropDatabase();
      await db.createCollection('user');
      await db.collection('user').createIndex({ email: 1 }, { unique: true, name: 'user_email_idx' });
      await db.collection('user').createIndex({ lastName: 1, email: -1 });
      await db.createCollection('user_view', { viewOn: 'user', pipeline: [] });
    });
  }, provisioningTimeout);

  afterAll(() => pool.end());

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

  /** A text index answers `_fts`/`_ftsx` as its key: its fields and weights are in `weights`, and `'none'` is `'simple'`. */
  it("should read a text index's fields and weights", async () => {
    await pool.withQuerier(async ({ db }) => {
      await db
        .collection('note')
        .createIndex(
          { zeta: 'text', alpha: 'text' },
          { name: 'note_text_idx', weights: { zeta: 10 }, default_language: 'none' },
        );
    });
    const schema = await introspector.getTableSchema('note');
    await pool.withQuerier(({ db }) => db.collection('note').drop());
    expect(schema?.indexes).toContainEqual({
      name: 'note_text_idx',
      entries: [{ column: 'alpha' }, { column: 'zeta', weight: 10 }],
      unique: false,
      type: 'fulltext',
      config: 'simple',
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
    await expect(new MongoSchemaIntrospector(other).getTableNames()).rejects.toThrow(UqlUsageError);
  });
});
