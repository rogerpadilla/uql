import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { QuerierPool, SqlQuerier } from '../../type/index.js';
import { PostgresSchemaIntrospector } from './postgresIntrospector.js';

class TestPostgresIntrospector extends PostgresSchemaIntrospector {
  public override normalizeType(dataType: string, udtName: string) {
    return super.normalizeType(dataType, udtName);
  }
  public override normalizeReferentialAction(action: string) {
    return super.normalizeReferentialAction(action);
  }
  public override isAutoIncrement(defaultValue: string | null, isIdentity: string) {
    return super.isAutoIncrement(defaultValue, isIdentity);
  }
  public override parseDefaultValue(defaultValue: string | null) {
    return super.parseDefaultValue(defaultValue);
  }
}

describe('PostgresSchemaIntrospector', () => {
  let introspector: TestPostgresIntrospector;
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

    introspector = new TestPostgresIntrospector(pool);
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
    expect(schema.name).toBe('users');
    expect(schema.columns).toHaveLength(1);
    expect(schema.foreignKeys).toHaveLength(1);
    expect(schema.primaryKey).toEqual(['id']);
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
    expect(introspector.normalizeType('USER-DEFINED', 'my_enum')).toBe('MY_ENUM');
    expect(introspector.normalizeType('ARRAY', '_int4')).toBe('INT4[]');
    expect(introspector.normalizeType('integer', 'int4')).toBe('INTEGER');
  });

  it('normalizeReferentialAction should handle various cases', () => {
    expect(introspector.normalizeReferentialAction('CASCADE')).toBe('CASCADE');
    expect(introspector.normalizeReferentialAction('SET NULL')).toBe('SET NULL');
    expect(introspector.normalizeReferentialAction('RESTRICT')).toBe('RESTRICT');
    expect(introspector.normalizeReferentialAction('NO ACTION')).toBe('NO ACTION');
    expect(introspector.normalizeReferentialAction('UNKNOWN')).toBeUndefined();
  });

  it('should throw error if not SQL querier', async () => {
    (pool.getQuerier as Mock).mockResolvedValue({ release: vi.fn() });
    await expect(introspector.getTableNames()).rejects.toThrow(
      'PostgresSchemaIntrospector requires a SQL-based querier',
    );
  });

  it('isAutoIncrement utility', () => {
    expect(introspector.isAutoIncrement("nextval('seq')", 'NO')).toBe(true);
    expect(introspector.isAutoIncrement(null, 'YES')).toBe(true);
    expect(introspector.isAutoIncrement('1', 'NO')).toBe(false);
    expect(introspector.isAutoIncrement(null, 'NO')).toBe(false);
  });

  it('parseDefaultValue utility', () => {
    expect(introspector.parseDefaultValue(null)).toBeUndefined();
    expect(introspector.parseDefaultValue("'val'::text")).toBe('val');
    expect(introspector.parseDefaultValue('true')).toBe(true);
    expect(introspector.parseDefaultValue('false')).toBe(false);
    expect(introspector.parseDefaultValue('NULL')).toBeNull();
    expect(introspector.parseDefaultValue('123')).toBe(123);
    expect(introspector.parseDefaultValue('123.45')).toBe(123.45);
    expect(introspector.parseDefaultValue('now()')).toBe('now()');
  });
});
