import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { QuerierPool, SqlQuerier } from '../../type/index.js';
import { MysqlSchemaIntrospector } from './mysqlIntrospector.js';

class TestMysqlIntrospector extends MysqlSchemaIntrospector {
  public override normalizeReferentialAction(action: string) {
    return super.normalizeReferentialAction(action);
  }
}

describe('MysqlSchemaIntrospector', () => {
  let introspector: TestMysqlIntrospector;
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

    introspector = new TestMysqlIntrospector(pool);
  });

  it('getTableNames should return a list of tables', async () => {
    mockAll.mockResolvedValueOnce([{ table_name: 'users' }, { table_name: 'posts' }]);

    const names = await introspector.getTableNames();

    expect(names).toEqual(['users', 'posts']);
    expect(querier.all).toHaveBeenCalledWith(expect.stringContaining('information_schema.TABLES'));
  });

  it('getTableSchema should return table details', async () => {
    // 1. tableExists check
    mockAll.mockResolvedValueOnce([{ count: 1 }]);
    // 2. getColumns
    mockAll.mockResolvedValueOnce([
      {
        column_name: 'id',
        data_type: 'int',
        column_type: 'int(11)',
        is_nullable: 'NO',
        column_default: null,
        character_maximum_length: null,
        numeric_precision: 10,
        numeric_scale: 0,
        column_key: 'PRI',
        extra: 'auto_increment',
        column_comment: 'User ID',
      },
      {
        column_name: 'email',
        data_type: 'varchar',
        column_type: 'varchar(255)',
        is_nullable: 'YES',
        column_default: null,
        character_maximum_length: 255,
        numeric_precision: null,
        numeric_scale: null,
        column_key: 'UNI',
        extra: '',
        column_comment: null,
      },
    ]);
    // 3. getIndexes
    mockAll.mockResolvedValueOnce([
      {
        index_name: 'email_unique',
        columns: 'email',
        is_unique: 1,
      },
    ]);
    // 4. getForeignKeys
    mockAll.mockResolvedValueOnce([]);
    // 5. getPrimaryKey
    mockAll.mockResolvedValueOnce([{ column_name: 'id' }]);

    const schema = await introspector.getTableSchema('users');

    expect(schema).toBeDefined();
    expect(schema?.name).toBe('users');
    expect(schema?.columns).toHaveLength(2);
    expect(schema?.columns[0]).toMatchObject({
      name: 'id',
      type: 'INT',
      nullable: false,
      isAutoIncrement: true,
      isPrimaryKey: true,
    });
    expect(schema?.indexes).toHaveLength(1);
    expect(schema?.indexes?.[0].name).toBe('email_unique');
    expect(schema?.indexes?.[0].unique).toBe(true);
  });

  it('getTableSchema should return undefined for non-existent table', async () => {
    mockAll.mockResolvedValueOnce([{ count: 0 }]);

    const schema = await introspector.getTableSchema('non_existent');

    expect(schema).toBeUndefined();
  });

  it('tableExists should return true if table exists', async () => {
    mockAll.mockResolvedValueOnce([{ count: 1 }]);
    const exists = await introspector.tableExists('users');
    expect(exists).toBe(true);
  });

  it('getTableSchema should include foreign keys with referential actions', async () => {
    // tableExists
    mockAll.mockResolvedValueOnce([{ count: 1 }]);
    // getColumns
    mockAll.mockResolvedValueOnce([]);
    // getIndexes
    mockAll.mockResolvedValueOnce([]);
    // getForeignKeys
    mockAll.mockResolvedValueOnce([
      {
        constraint_name: 'fk_posts_user_id',
        columns: 'user_id',
        referenced_table: 'users',
        referenced_columns: 'id',
        delete_rule: 'CASCADE',
        update_rule: 'NO ACTION',
      },
    ]);
    // getPrimaryKey
    mockAll.mockResolvedValueOnce([]);

    const schema = await introspector.getTableSchema('posts');

    expect(schema?.foreignKeys).toHaveLength(1);
    expect(schema?.foreignKeys?.[0]).toMatchObject({
      name: 'fk_posts_user_id',
      columns: ['user_id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
      onDelete: 'CASCADE',
      onUpdate: 'NO ACTION',
    });
  });

  it('normalizeReferentialAction should handle various cases', async () => {
    expect(introspector.normalizeReferentialAction('CASCADE')).toBe('CASCADE');
    expect(introspector.normalizeReferentialAction('SET NULL')).toBe('SET NULL');
    expect(introspector.normalizeReferentialAction('RESTRICT')).toBe('RESTRICT');
    expect(introspector.normalizeReferentialAction('NO ACTION')).toBe('NO ACTION');
    expect(introspector.normalizeReferentialAction('UNKNOWN')).toBeUndefined();
  });
});
