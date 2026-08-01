import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { MongoDialect } from '../../mongo/mongoDialect.js';
import { createMockQuerierPool } from '../../test/mockQuerierPool.js';
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

    pool = createMockQuerierPool(new MongoDialect(), vi.fn().mockResolvedValue(querier));

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
    expect(schema!.name).toBe('users');
    expect(schema!.indexes).toHaveLength(2);
    expect(schema!.indexes![1]).toMatchObject({
      name: 'idx_username',
      columns: [{ column: 'username' }],
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

  it('tableExists should return true for existing collection', async () => {
    db.listCollections.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([{ name: 'users' }, { name: 'posts' }]),
    });

    const exists = await introspector.tableExists('users');

    expect(exists).toBe(true);
  });

  it('tableExists should return false for non-existing collection', async () => {
    db.listCollections.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([{ name: 'users' }]),
    });

    const exists = await introspector.tableExists('non_existent');

    expect(exists).toBe(false);
  });

  /** A compound index has no `name` of its own unless one was given; its keys name it. */
  it('getTableSchema should name an unnamed index after its keys', async () => {
    db.listCollections.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([{ name: 'users' }]),
    });
    db.collection.mockReturnValueOnce({
      indexes: vi.fn().mockResolvedValue([{ key: { lastName: 1, firstName: 1 } }]),
    });

    const schema = await introspector.getTableSchema('users');

    expect(schema!.indexes![0]).toEqual({
      name: 'lastName_firstName',
      columns: [{ column: 'lastName' }, { column: 'firstName' }],
      unique: false,
    });
  });

  /** Mongo has no columns to read, so the indexed fields are the only ones the AST can know about. */
  it('introspect should derive columns from indexed fields and share them across indexes', async () => {
    db.listCollections
      .mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([{ name: 'users' }]) })
      .mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([{ name: 'users' }]) });
    db.collection.mockReturnValueOnce({
      indexes: vi.fn().mockResolvedValue([
        { name: 'idx_email', key: { email: 1 }, unique: true },
        { name: 'idx_email_status', key: { email: 1, status: 1 } },
      ]),
    });

    const ast = await introspector.introspect();
    const table = ast.getTable('users')!;

    expect([...table.columns.keys()]).toEqual(['email', 'status']);
    expect(table.indexes.map((idx) => ({ name: idx.name, unique: idx.unique }))).toEqual([
      { name: 'idx_email', unique: true },
      { name: 'idx_email_status', unique: false },
    ]);
    // The shared column is one node, referenced by both indexes.
    expect(table.indexes[1].columns[0]).toBe(table.columns.get('email'));
  });

  it('introspect should skip a collection that disappears before it can be described', async () => {
    db.listCollections
      .mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([{ name: 'dropped' }]) })
      .mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([]) });

    const ast = await introspector.introspect();

    expect(ast.getTables()).toHaveLength(0);
  });

  it('introspect should return SchemaAST with all collections', async () => {
    // First call for getTableNames
    db.listCollections.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([{ name: 'users' }]),
    });
    // Second call for getTableSchema('users')
    db.listCollections.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([{ name: 'users' }]),
    });
    db.collection.mockReturnValueOnce({
      indexes: vi.fn().mockResolvedValue([{ name: '_id_', key: { _id: 1 } }]),
    });

    const ast = await introspector.introspect();

    expect(ast.getTables()).toHaveLength(1);
    expect(ast.getTable('users')).toBeDefined();
  });
});
