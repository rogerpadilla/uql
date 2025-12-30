import { beforeEach, describe, expect, it, jest } from 'bun:test';
import type { QuerierPool, SqlQuerier } from '../../type/index.js';
import { MysqlSchemaIntrospector } from './mysqlIntrospector.js';

describe('MysqlSchemaIntrospector', () => {
  let introspector: MysqlSchemaIntrospector;
  let pool: QuerierPool;
  let querier: SqlQuerier;

  let mockAll: ReturnType<typeof jest.fn>;
  let mockRun: ReturnType<typeof jest.fn>;
  let mockRelease: ReturnType<typeof jest.fn>;
  let mockGetQuerier: ReturnType<typeof jest.fn>;

  beforeEach(() => {
    mockAll = jest.fn<any>().mockResolvedValue([]);
    mockRun = jest.fn<any>().mockResolvedValue({});
    mockRelease = jest.fn<any>().mockResolvedValue(undefined);

    querier = {
      all: mockAll,
      run: mockRun,
      release: mockRelease,
      dialect: { escapeIdChar: '`' },
    } as any;

    mockGetQuerier = jest.fn<any>().mockResolvedValue(querier);
    pool = {
      getQuerier: mockGetQuerier,
    } as any;

    introspector = new MysqlSchemaIntrospector(pool);
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
});
