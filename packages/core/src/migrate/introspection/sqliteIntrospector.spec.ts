import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { QuerierPool, SqlQuerier } from '../../type/index.js';
import { SqliteSchemaIntrospector } from './sqliteIntrospector.js';

describe('SqliteSchemaIntrospector', () => {
  let introspector: SqliteSchemaIntrospector;
  let pool: QuerierPool;
  let querier: SqlQuerier;

  let mockAll: Mock<(sql: any, params?: any[]) => Promise<any[]>>;
  let mockRun: Mock<(sql: any, params?: any[]) => Promise<any>>;
  let mockRelease: Mock<() => Promise<void>>;
  let mockGetQuerier: Mock<() => Promise<SqlQuerier>>;

  beforeEach(() => {
    mockAll = vi.fn().mockResolvedValue([]);
    mockRun = vi.fn().mockResolvedValue({});
    mockRelease = vi.fn().mockResolvedValue(undefined);

    querier = {
      all: mockAll,
      run: mockRun,
      release: mockRelease,
      dialect: { escapeIdChar: '`' },
    } as unknown as SqlQuerier;

    mockGetQuerier = vi.fn().mockResolvedValue(querier);
    pool = {
      getQuerier: mockGetQuerier,
    } as unknown as QuerierPool;

    introspector = new SqliteSchemaIntrospector(pool);
  });

  it('getTableNames should return a list of tables', async () => {
    mockAll.mockImplementation((sql: string) => {
      if (sql.includes('sqlite_master')) {
        return Promise.resolve([{ name: 'users' }, { name: 'posts' }]);
      }
      return Promise.resolve([]);
    });

    const names = await introspector.getTableNames();

    expect(names).toEqual(['users', 'posts']);
    expect(querier.all).toHaveBeenCalledWith(expect.stringContaining("type = 'table'"));
  });

  it('tableExists should return true if table exists', async () => {
    mockAll.mockImplementation((sql: string) => {
      if (sql.includes('sqlite_master')) {
        return Promise.resolve([{ count: 1 }]);
      }
      return Promise.resolve([]);
    });
    const exists = await introspector.tableExists('users');
    expect(exists).toBe(true);
  });

  it('getTableSchema should return table details', async () => {
    mockAll.mockImplementation((sql: string) => {
      if (sql.includes('sqlite_master')) {
        return Promise.resolve([{ count: 1 }]);
      }
      if (sql.includes('table_info')) {
        return Promise.resolve([
          {
            name: 'id',
            type: 'INTEGER',
            notnull: 1,
            dflt_value: null,
            pk: 1,
          },
          {
            name: 'name',
            type: 'TEXT',
            notnull: 0,
            dflt_value: "'Guest'",
            pk: 0,
          },
        ]);
      }
      if (sql.includes('index_list')) {
        return Promise.resolve([
          {
            name: 'idx_users_name',
            unique: 0,
            origin: 'c',
          },
        ]);
      }
      if (sql.includes('index_info')) {
        return Promise.resolve([
          {
            name: 'name',
          },
        ]);
      }
      if (sql.includes('foreign_key_list')) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    const schema = await introspector.getTableSchema('users');

    expect(schema).toBeDefined();
    expect(schema?.name).toBe('users');
    expect(schema?.columns).toHaveLength(2);
    expect(schema?.columns[0]).toMatchObject({
      name: 'id',
      type: 'INTEGER',
      nullable: false,
      isPrimaryKey: true,
    });
    expect(schema?.columns[1].defaultValue).toBe('Guest');
    expect(schema?.indexes).toHaveLength(1);
    expect(schema?.indexes?.[0].name).toBe('idx_users_name');
    expect(schema?.indexes?.[0].columns).toEqual(['name']);
  });

  it('getTableSchema with foreign keys and empty primary key', async () => {
    mockAll.mockImplementation((sql: string) => {
      if (sql.includes('sqlite_master')) {
        return Promise.resolve([{ count: 1 }]);
      }
      if (sql.includes('table_info')) {
        return Promise.resolve([{ name: 'user_id', type: 'INTEGER', notnull: 1, pk: 0 }]);
      }
      if (sql.includes('foreign_key_list')) {
        return Promise.resolve([
          {
            id: 0,
            table: 'users',
            from: 'user_id',
            to: 'id',
            on_update: 'CASCADE',
            on_delete: 'RESTRICT',
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const schema = await introspector.getTableSchema('posts');
    expect(schema?.foreignKeys).toHaveLength(1);
    expect(schema?.foreignKeys?.[0]).toMatchObject({
      referencedTable: 'users',
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });
    expect(schema?.primaryKey).toBeUndefined();
  });

  it('normalizeType and extractLength', () => {
    const normalize = (introspector as any).normalizeType.bind(introspector);
    const extract = (introspector as any).extractLength.bind(introspector);
    expect(normalize('VARCHAR(255)')).toBe('VARCHAR');
    expect(normalize('INTEGER')).toBe('INTEGER');
    expect(extract('VARCHAR(255)')).toBe(255);
    expect(extract('INTEGER')).toBeUndefined();
  });

  it('parseDefaultValue utility', () => {
    const parse = (introspector as any).parseDefaultValue.bind(introspector);
    expect(parse(null)).toBeUndefined();
    expect(parse('NULL')).toBeNull();
    expect(parse('CURRENT_TIMESTAMP')).toBe('CURRENT_TIMESTAMP');
    expect(parse("'val'")).toBe('val');
    expect(parse('123')).toBe(123);
    expect(parse('123.45')).toBe(123.45);
    expect(parse('random')).toBe('random');
  });

  it('normalizeReferentialAction utility', () => {
    const normalize = (introspector as any).normalizeReferentialAction.bind(introspector);
    expect(normalize('CASCADE')).toBe('CASCADE');
    expect(normalize('SET NULL')).toBe('SET NULL');
    expect(normalize('RESTRICT')).toBe('RESTRICT');
    expect(normalize('NO ACTION')).toBe('NO ACTION');
    expect(normalize('UNKNOWN')).toBeUndefined();
  });

  it('should throw error if not SQL querier', async () => {
    (pool.getQuerier as Mock).mockResolvedValue({ release: vi.fn() });
    await expect(introspector.getTableNames()).rejects.toThrow('SqliteSchemaIntrospector requires a SQL-based querier');
  });
});
