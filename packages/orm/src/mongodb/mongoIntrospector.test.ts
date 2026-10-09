import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { indexColumns } from '../schema/indexColumns.js';
import { assertDefined, mongoUri, provisioningTimeout } from '../test/index.js';
import { validatorCheck } from './mongoCommand.js';
import { MongoSchemaIntrospector } from './mongoIntrospector.js';
import { MongodbQuerierPool } from './mongodbQuerierPool.js';

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

  /** What drift compares a text index by, so a whole introspection has to keep it too. */
  it("should keep a text index's language in the tables it introspects", async () => {
    await pool.withQuerier(({ db }) =>
      db.collection('note').createIndex({ body: 'text' }, { name: 'note_body_idx', default_language: 'english' }),
    );
    const table = (await introspector.introspect()).getTable('note');
    await pool.withQuerier(({ db }) => db.collection('note').drop());
    expect(table?.indexes.find((index) => index.name === 'note_body_idx')?.config).toBe('english');
  });

  /** Its one validator, named for its JSON as an owned check is for its SQL, so an edited one reads as another. */
  it("should read a collection's validator as its check", async () => {
    const validator = { status: { $in: ['open', null] } };
    await pool.withQuerier(({ db }) => db.createCollection('task', { validator }));
    const schema = await introspector.getTableSchema('task');
    const table = (await introspector.introspect(['task'])).getTable('task');
    await pool.withQuerier(({ db }) => db.collection('task').drop());

    expect(schema?.checks).toEqual([validatorCheck('task', validator)]);
    expect(table?.checks).toEqual([validatorCheck('task', validator)]);
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
});
