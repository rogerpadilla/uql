import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { QuerierPool, SqlQuerier } from '../../type/index.js';
import { PostgresSchemaIntrospector } from './postgresIntrospector.js';

describe('PostgresSchemaIntrospector', () => {
  let introspector: PostgresSchemaIntrospector;
  let pool: QuerierPool;
  let querier: jest.Mocked<SqlQuerier>;

  beforeEach(() => {
    querier = {
      all: jest.fn<any>().mockResolvedValue([]),
      run: jest.fn<any>().mockResolvedValue({}),
      release: jest.fn<any>().mockResolvedValue(undefined),
      dialect: { escapeIdChar: '"' },
    } as any;

    pool = {
      getQuerier: jest.fn<any>().mockResolvedValue(querier),
    } as any;

    introspector = new PostgresSchemaIntrospector(pool);
  });

  it('getTableNames should return a list of tables', async () => {
    querier.all.mockResolvedValueOnce([{ table_name: 'users' }, { table_name: 'posts' }]);

    const names = await introspector.getTableNames();

    expect(names).toEqual(['users', 'posts']);
    expect(querier.all).toHaveBeenCalledWith(expect.stringContaining('information_schema.tables'));
  });

  it('getTableSchema should return table details', async () => {
    // 1. tableExists check
    querier.all.mockResolvedValueOnce([{ exists: true }]);
    // 2. getColumns
    querier.all.mockResolvedValueOnce([
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
    querier.all.mockResolvedValueOnce([
      {
        index_name: 'idx_users_name',
        columns: ['name'],
        is_unique: false,
      },
    ]);
    // 4. getForeignKeys
    querier.all.mockResolvedValueOnce([]);
    // 5. getPrimaryKey
    querier.all.mockResolvedValueOnce([{ column_name: 'id' }]);

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
    querier.all.mockResolvedValueOnce([{ exists: false }]);

    const schema = await introspector.getTableSchema('non_existent');

    expect(schema).toBeUndefined();
  });
});
