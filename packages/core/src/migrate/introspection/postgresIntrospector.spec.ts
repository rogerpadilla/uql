import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { QuerierPool, SqlQuerier } from '../../type/index.js';
import { PostgresSchemaIntrospector } from './postgresIntrospector.js';

describe('PostgresSchemaIntrospector', () => {
  let introspector: PostgresSchemaIntrospector;
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
      dialect: { escapeIdChar: '"' },
    } as unknown as SqlQuerier;

    mockGetQuerier = vi.fn().mockResolvedValue(querier);
    pool = {
      getQuerier: mockGetQuerier,
    } as unknown as QuerierPool;

    introspector = new PostgresSchemaIntrospector(pool);
  });

  it('getTableNames should return a list of tables', async () => {
    mockAll.mockResolvedValueOnce([{ table_name: 'users' }, { table_name: 'posts' }]);

    const names = await introspector.getTableNames();

    expect(names).toEqual(['users', 'posts']);
    expect(querier.all).toHaveBeenCalledWith(expect.stringContaining('information_schema.tables'));
  });

  it('getTableSchema should return table details', async () => {
    mockAll.mockImplementation((sql: string) => {
      if (sql.includes('EXISTS')) {
        return Promise.resolve([{ exists: true }]);
      }
      if (sql.includes('information_schema.columns')) {
        return Promise.resolve([
          {
            column_name: 'id',
            data_type: 'integer',
            udt_name: 'int4',
            is_nullable: 'NO',
            column_default: "nextval('users_id_seq'::regclass)",
            is_primary_key: true,
            is_unique: false,
          },
        ]);
      }
      if (sql.includes('pg_index')) {
        return Promise.resolve([
          {
            index_name: 'idx1',
            columns: ['name'],
            is_unique: false,
          },
        ]);
      }
      if (sql.includes("constraint_type = 'FOREIGN KEY'")) {
        return Promise.resolve([
          {
            constraint_name: 'fk1',
            columns: ['user_id'],
            referenced_table: 'users',
            referenced_columns: ['id'],
            delete_rule: 'CASCADE',
            update_rule: 'NO ACTION',
          },
        ]);
      }
      if (sql.includes("constraint_type = 'PRIMARY KEY'")) {
        return Promise.resolve([{ column_name: 'id' }]);
      }
      return Promise.resolve([]);
    });

    const schema = await introspector.getTableSchema('users');

    expect(schema).toBeDefined();
    expect(schema?.name).toBe('users');
    expect(schema?.columns).toHaveLength(1);
    expect(schema?.foreignKeys).toHaveLength(1);
    expect(schema?.primaryKey).toEqual(['id']);
  });

  it('getTableSchema should return undefined for non-existent table', async () => {
    mockAll.mockResolvedValueOnce([{ exists: false }]);

    const schema = await introspector.getTableSchema('non_existent');

    expect(schema).toBeUndefined();
  });

  it('tableExists should return true if table exists', async () => {
    mockAll.mockResolvedValueOnce([{ exists: true }]);
    const exists = await introspector.tableExists('users');
    expect(exists).toBe(true);
  });

  it('normalizeType should handle user-defined and array types', () => {
    const normalize = (introspector as any).normalizeType.bind(introspector);
    expect(normalize('USER-DEFINED', 'my_enum')).toBe('MY_ENUM');
    expect(normalize('ARRAY', '_int4')).toBe('int4[]');
    expect(normalize('integer', 'int4')).toBe('INTEGER');
  });

  it('normalizeReferentialAction should handle various cases', () => {
    const normalize = (introspector as any).normalizeReferentialAction.bind(introspector);
    expect(normalize('CASCADE')).toBe('CASCADE');
    expect(normalize('SET NULL')).toBe('SET NULL');
    expect(normalize('RESTRICT')).toBe('RESTRICT');
    expect(normalize('NO ACTION')).toBe('NO ACTION');
    expect(normalize('UNKNOWN')).toBeUndefined();
  });

  it('should throw error if not SQL querier', async () => {
    (pool.getQuerier as Mock).mockResolvedValue({ release: vi.fn() });
    await expect(introspector.getTableNames()).rejects.toThrow(
      'PostgresSchemaIntrospector requires a SQL-based querier',
    );
  });

  it('isAutoIncrement utility', () => {
    expect((introspector as any).isAutoIncrement("nextval('seq')")).toBe(true);
    expect((introspector as any).isAutoIncrement('1')).toBe(false);
    expect((introspector as any).isAutoIncrement(null)).toBe(false);
  });

  it('parseDefaultValue utility', () => {
    const parse = (introspector as any).parseDefaultValue.bind(introspector);
    expect(parse(null)).toBeUndefined();
    expect(parse("'val'::text")).toBe('val');
    expect(parse('true')).toBe(true);
    expect(parse('false')).toBe(false);
    expect(parse('NULL')).toBeNull();
    expect(parse('123')).toBe(123);
    expect(parse('123.45')).toBe(123.45);
    expect(parse('now()')).toBe('now()');
  });
});
