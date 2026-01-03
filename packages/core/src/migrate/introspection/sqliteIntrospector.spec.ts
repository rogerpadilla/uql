import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { QuerierPool, SqlQuerier } from '../../type/index.js';
import { SqliteSchemaIntrospector } from './sqliteIntrospector.js';

class TestSqliteIntrospector extends SqliteSchemaIntrospector {
  public override normalizeType(type: string) {
    return super.normalizeType(type);
  }
  public override extractLength(type: string) {
    return super.extractLength(type);
  }
  public override parseDefaultValue(defaultValue: string | null) {
    return super.parseDefaultValue(defaultValue);
  }
  public override normalizeReferentialAction(action: string) {
    return super.normalizeReferentialAction(action);
  }
}

describe('SqliteSchemaIntrospector', () => {
  let introspector: TestSqliteIntrospector;
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

    introspector = new TestSqliteIntrospector(pool);
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
    expect(introspector.normalizeType('VARCHAR(255)')).toBe('VARCHAR');
    expect(introspector.normalizeType('INTEGER')).toBe('INTEGER');
    expect(introspector.extractLength('VARCHAR(255)')).toBe(255);
    expect(introspector.extractLength('INTEGER')).toBeUndefined();
  });

  it('parseDefaultValue utility', () => {
    expect(introspector.parseDefaultValue(null)).toBeUndefined();
    expect(introspector.parseDefaultValue('NULL')).toBeNull();
    expect(introspector.parseDefaultValue('CURRENT_TIMESTAMP')).toBe('CURRENT_TIMESTAMP');
    expect(introspector.parseDefaultValue("'val'")).toBe('val');
    expect(introspector.parseDefaultValue('123')).toBe(123);
    expect(introspector.parseDefaultValue('123.45')).toBe(123.45);
    expect(introspector.parseDefaultValue('random')).toBe('random');
  });

  it('normalizeReferentialAction utility', () => {
    expect(introspector.normalizeReferentialAction('CASCADE')).toBe('CASCADE');
    expect(introspector.normalizeReferentialAction('SET NULL')).toBe('SET NULL');
    expect(introspector.normalizeReferentialAction('RESTRICT')).toBe('RESTRICT');
    expect(introspector.normalizeReferentialAction('NO ACTION')).toBe('NO ACTION');
    expect(introspector.normalizeReferentialAction('UNKNOWN')).toBeUndefined();
  });

  it('getTableSchema should return undefined for non-existent table', async () => {
    mockAll.mockImplementation((sql: string) => {
      if (sql.includes('sqlite_master')) {
        return Promise.resolve([{ count: 0 }]);
      }
      return Promise.resolve([]);
    });

    const schema = await introspector.getTableSchema('non_existent');
    expect(schema).toBeUndefined();
  });

  it('getColumns should identify single-column unique constraints', async () => {
    mockAll.mockImplementation((sql: string) => {
      if (sql.includes('sqlite_master')) {
        return Promise.resolve([{ count: 1 }]);
      }
      if (sql.includes('table_info')) {
        return Promise.resolve([{ name: 'email', type: 'TEXT', notnull: 0, pk: 0 }]);
      }
      if (sql.includes('index_list')) {
        return Promise.resolve([{ name: 'idx_email', unique: 1, origin: 'u' }]);
      }
      if (sql.includes('index_info')) {
        return Promise.resolve([{ name: 'email' }]);
      }
      return Promise.resolve([]);
    });

    const schema = await introspector.getTableSchema('users');
    expect(schema?.columns[0].isUnique).toBe(true);
  });

  it('getIndexes should skip auto-generated indexes', async () => {
    mockAll.mockImplementation((sql: string) => {
      if (sql.includes('sqlite_master')) {
        return Promise.resolve([{ count: 1 }]);
      }
      if (sql.includes('table_info')) {
        return Promise.resolve([{ name: 'id', type: 'INTEGER', notnull: 1, pk: 1 }]);
      }
      if (sql.includes('index_list')) {
        return Promise.resolve([
          { name: 'sqlite_autoindex_users_1', unique: 1, origin: 'pk' },
          { name: 'idx_custom', unique: 0, origin: 'c' },
        ]);
      }
      if (sql.includes('index_info')) {
        return Promise.resolve([{ name: 'name' }]);
      }
      return Promise.resolve([]);
    });

    const schema = await introspector.getTableSchema('users');
    expect(schema?.indexes).toHaveLength(1);
    expect(schema?.indexes?.[0].name).toBe('idx_custom');
  });

  it('getColumns should skip multi-column unique constraints', async () => {
    mockAll.mockImplementation((sql: string) => {
      if (sql.includes('sqlite_master')) {
        return Promise.resolve([{ count: 1 }]);
      }
      if (sql.includes('table_info')) {
        return Promise.resolve([{ name: 'id', type: 'INTEGER', notnull: 0, pk: 0 }]);
      }
      if (sql.includes('index_list')) {
        return Promise.resolve([{ name: 'idx_multi', unique: 1, origin: 'u' }]);
      }
      if (sql.includes('index_info')) {
        return Promise.resolve([{ name: 'col1' }, { name: 'col2' }]);
      }
      return Promise.resolve([]);
    });

    const schema = await introspector.getTableSchema('users');
    expect(schema?.columns[0].isUnique).toBe(false);
  });

  it('normalizeType should handle non-matching strings', () => {
    expect(introspector.normalizeType('123')).toBe('123');
  });

  it('escapeId should handle backticks', async () => {
    mockAll.mockImplementation((sql: string) => {
      if (sql.includes('sqlite_master')) return Promise.resolve([{ count: 1 }]);
      return Promise.resolve([]);
    });
    await introspector.getTableSchema('my`table');
    expect(mockAll).toHaveBeenCalledWith(expect.stringContaining('`my``table`'));
  });

  it('tableExists should return false if results are empty', async () => {
    mockAll.mockResolvedValue([]);
    const exists = await introspector.tableExists('users');
    expect(exists).toBe(false);
  });

  it('should throw error if not SQL querier', async () => {
    (pool.getQuerier as Mock).mockResolvedValue({ release: vi.fn() });
    await expect(introspector.getTableNames()).rejects.toThrow('SqliteSchemaIntrospector requires a SQL-based querier');
  });
});
