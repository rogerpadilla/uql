import { beforeEach, describe, expect, it, jest } from 'bun:test';
import type { QuerierPool, SqlQuerier } from '../../type/index.js';
import { PostgresSchemaIntrospector } from './postgresIntrospector.js';

describe('PostgresSchemaIntrospector', () => {
  let introspector: PostgresSchemaIntrospector;
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
      dialect: { escapeIdChar: '"' },
    } as any;

    mockGetQuerier = jest.fn<any>().mockResolvedValue(querier);
    pool = {
      getQuerier: mockGetQuerier,
    } as any;

    introspector = new PostgresSchemaIntrospector(pool);
  });

  it('getTableNames should return a list of tables', async () => {
    mockAll.mockResolvedValueOnce([{ table_name: 'users' }, { table_name: 'posts' }]);

    const names = await introspector.getTableNames();

    expect(names).toEqual(['users', 'posts']);
    expect(querier.all).toHaveBeenCalledWith(expect.stringContaining('information_schema.tables'));
  });

  it('getTableSchema should return table details', async () => {
    // 1. tableExists check
    mockAll.mockResolvedValueOnce([{ exists: true }]);
    // 2. getColumns
    mockAll.mockResolvedValueOnce([
      {
        column_name: 'id',
        data_type: 'integer',
        udt_name: 'int4',
        is_nullable: 'NO',
        column_default: "nextval('users_id_seq'::regclass)",
        character_maximum_length: null,
        numeric_precision: 32,
        numeric_scale: 0,
        is_primary_key: true,
        is_unique: false,
        column_comment: 'User ID',
      },
      {
        column_name: 'name',
        data_type: 'character varying',
        udt_name: 'varchar',
        is_nullable: 'YES',
        column_default: null,
        character_maximum_length: 255,
        numeric_precision: null,
        numeric_scale: null,
        is_primary_key: false,
        is_unique: false,
        column_comment: null,
      },
    ]);
    // 3. getIndexes
    mockAll.mockResolvedValueOnce([
      {
        index_name: 'idx_users_name',
        columns: ['name'],
        is_unique: false,
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
      type: 'INTEGER',
      nullable: false,
      isAutoIncrement: true,
      isPrimaryKey: true,
    });
    expect(schema?.indexes).toHaveLength(1);
    expect(schema?.indexes?.[0].name).toBe('idx_users_name');
  });

  it('getTableSchema should return undefined for non-existent table', async () => {
    mockAll.mockResolvedValueOnce([{ exists: false }]);

    const schema = await introspector.getTableSchema('non_existent');

    expect(schema).toBeUndefined();
  });
});
