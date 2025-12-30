import { beforeEach, describe, expect, it, jest } from 'bun:test';
import type { QuerierPool, SqlQuerier } from '../../type/index.js';
import { SqliteSchemaIntrospector } from './sqliteIntrospector.js';

describe('SqliteSchemaIntrospector', () => {
  let introspector: SqliteSchemaIntrospector;
  let pool: QuerierPool;
  let querier: SqlQuerier;

  let mockAll: ReturnType<typeof jest.fn>;
  let mockRun: ReturnType<typeof jest.fn>;
  let mockRelease: ReturnType<typeof jest.fn>;
  let mockGetQuerier: ReturnType<typeof jest.fn>;

  beforeEach(() => {
    querier = {
      all: jest.fn<any>().mockResolvedValue([]) as any,
      run: jest.fn<any>().mockResolvedValue({}) as any,
      release: jest.fn<any>().mockResolvedValue(undefined) as any,
      dialect: { escapeIdChar: '`' },
    } as any;

    pool = {
      getQuerier: jest.fn<any>().mockResolvedValue(querier) as any,
    } as any;

    introspector = new SqliteSchemaIntrospector(pool);
  });

  it('getTableNames should return a list of tables', async () => {
    mockAll.mockResolvedValueOnce([{ name: 'users' }, { name: 'posts' }]);

    const names = await introspector.getTableNames();

    expect(names).toEqual(['users', 'posts']);
    expect(querier.all).toHaveBeenCalledWith(expect.stringContaining('sqlite_master'));
  });

  it('getTableSchema should return table details', async () => {
    mockAll.mockImplementation((async (sql: string, _values?: unknown[]) => {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();
      if (normalizedSql.includes('SELECT COUNT(*) as count FROM sqlite_master')) {
        return [{ count: 1 }];
      }
      if (normalizedSql.includes('PRAGMA table_info')) {
        return [
          { cid: 0, name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null as any, pk: 1 },
          { cid: 1, name: 'username', type: 'VARCHAR(255)', notnull: 0, dflt_value: null as any, pk: 0 },
        ];
      }
      if (normalizedSql.includes('PRAGMA index_list')) {
        return [
          { seq: 0, name: 'sqlite_autoindex_users_1', unique: 1, origin: 'u', partial: 0 },
          { seq: 1, name: 'idx_users_username', unique: 0, origin: 'c', partial: 0 },
        ];
      }
      if (normalizedSql.includes('PRAGMA index_info')) {
        return [{ name: 'username' }];
      }
      if (normalizedSql.includes('PRAGMA foreign_key_list')) {
        return [
          {
            id: 0,
            seq: 0,
            table: 'users',
            from: 'author_id',
            to: 'id',
            on_update: 'CASCADE',
            on_delete: 'RESTRICT',
            match: 'NONE',
          },
        ];
      }
      return [];
    }) as any);

    const schema = await introspector.getTableSchema('users');

    expect(schema).toBeDefined();
    expect(schema?.name).toBe('users');
    expect(schema?.columns).toHaveLength(2);
    expect(schema?.columns[0]).toMatchObject({
      name: 'id',
      type: 'INTEGER',
      nullable: false,
      isAutoIncrement: true,
      isPrimaryKey: true,
    });
    expect(schema?.columns[1]).toMatchObject({
      name: 'username',
      type: 'VARCHAR',
      nullable: true,
      isUnique: true,
      length: 255,
    });
    expect(schema?.indexes).toHaveLength(1);
    expect(schema?.indexes?.[0].name).toBe('idx_users_username');
  });

  it('getTableSchema should return undefined for non-existent table', async () => {
    mockAll.mockResolvedValueOnce([{ count: 0 }]);

    const schema = await introspector.getTableSchema('non_existent');

    expect(schema).toBeUndefined();
  });
});
