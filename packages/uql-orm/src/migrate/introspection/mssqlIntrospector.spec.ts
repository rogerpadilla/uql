import { describe, expect, it, vi } from 'vitest';
import { MsSqlDialect } from '../../mssql/mssqlDialect.js';
import type { QuerierPool, RawRow } from '../../type/index.js';
import { MsSqlSchemaIntrospector } from './mssqlIntrospector.js';

/**
 * A pool whose single querier answers each statement from `rows`, keyed by a fragment of its text.
 * The longest matching fragment wins, since several of these queries read the same catalogue views.
 */
function poolAnswering(rows: Record<string, RawRow[]>): QuerierPool {
  const all = vi.fn(async (sql: string) => {
    const key = Object.keys(rows)
      .filter((fragment) => sql.includes(fragment))
      .sort((a, b) => b.length - a.length)[0];
    return key ? rows[key] : [];
  });
  const querier = { all, run: vi.fn(), dialect: new MsSqlDialect({}) };
  return {
    dialect: querier.dialect,
    withQuerier: (task: (q: typeof querier) => unknown) => task(querier),
  } as unknown as QuerierPool;
}

describe('MsSqlSchemaIntrospector', () => {
  it('should list the base tables of the connection schema', async () => {
    const introspector = new MsSqlSchemaIntrospector(
      poolAnswering({ 'INFORMATION_SCHEMA.TABLES': [{ table_name: 'User' }, { table_name: 'Company' }] }),
    );

    expect(await introspector.getTableNames()).toEqual(['User', 'Company']);
  });

  it('should default to the connection schema and take a named one', async () => {
    const pool = poolAnswering({});
    expect(new MsSqlSchemaIntrospector(pool).schema).toBeUndefined();
    expect(new MsSqlSchemaIntrospector(pool, 'crm').schema).toBe('crm');
  });

  /**
   * `max_length` is bytes: an `NVARCHAR` reports twice its declared width and `MAX` reports `-1`.
   * Read as characters, every Unicode column drifts to double its width against its own entity.
   */
  it('should read an NVARCHAR width back in characters', async () => {
    const introspector = new MsSqlSchemaIntrospector(
      poolAnswering({
        'COUNT(*) as count': [{ count: 1 }],
        'sys.columns': [
          {
            column_name: 'name',
            data_type: 'nvarchar',
            max_length: 510,
            numeric_precision: 0,
            numeric_scale: 0,
            is_nullable: false,
            is_identity: false,
            column_default: null,
          },
          {
            column_name: 'bio',
            data_type: 'nvarchar',
            max_length: -1,
            numeric_precision: 0,
            numeric_scale: 0,
            is_nullable: true,
            is_identity: false,
            column_default: null,
          },
          {
            column_name: 'id',
            data_type: 'int',
            max_length: 4,
            numeric_precision: 10,
            numeric_scale: 0,
            is_nullable: false,
            is_identity: true,
            column_default: null,
            is_primary_key: 1,
            is_unique: 0,
          },
        ],
      }),
    );

    const table = await introspector.getTableSchema('User');

    expect(table?.columns[0]).toMatchObject({ name: 'name', type: 'NVARCHAR', length: 255, nullable: false });
    expect(table?.columns[1]).toMatchObject({ name: 'bio', type: 'NVARCHAR(MAX)', length: undefined });
    expect(table?.columns[2]).toMatchObject({ name: 'id', isAutoIncrement: true, isPrimaryKey: true, isUnique: false });
  });

  /** The engine reprints a default from its own parse tree, wrapped in at least one paren layer. */
  it('should unwrap the parentheses a default is stored in', async () => {
    const introspector = new MsSqlSchemaIntrospector(
      poolAnswering({
        'COUNT(*) as count': [{ count: 1 }],
        'sys.columns': [
          { column_name: 'n', data_type: 'int', max_length: 4, is_nullable: true, column_default: '((0))' },
          { column_name: 's', data_type: 'nvarchar', max_length: 20, is_nullable: true, column_default: "(N'x')" },
          { column_name: 'u', data_type: 'int', max_length: 4, is_nullable: true, column_default: null },
        ],
      }),
    );

    const columns = (await introspector.getTableSchema('T'))?.columns;

    expect(columns?.map((column) => column.defaultValue)).toEqual([0, 'x', undefined]);
  });

  /** A stored `NULL` is no default at all; a decimal reads back as a number; only a Unicode type halves its bytes. */
  it('should read a NULL and a decimal default, and size a column by its encoding', async () => {
    const introspector = new MsSqlSchemaIntrospector(
      poolAnswering({
        'COUNT(*) as count': [{ count: 1 }],
        'sys.columns': [
          { column_name: 'a', data_type: 'varchar', max_length: 20, is_nullable: true, column_default: '(NULL)' },
          { column_name: 'b', data_type: 'nvarchar', max_length: 20, is_nullable: true, column_default: '((1.5))' },
        ],
      }),
    );

    const columns = (await introspector.getTableSchema('T'))?.columns;

    expect(columns?.map((column) => [column.defaultValue, column.length])).toEqual([
      [null, 20],
      [1.5, 10],
    ]);
  });

  /** `sys` spells a referential action with an underscore, where the shared vocabulary uses a space. */
  it('should normalize the referential actions sys reports', async () => {
    const introspector = new MsSqlSchemaIntrospector(
      poolAnswering({
        'COUNT(*) as count': [{ count: 1 }],
        'sys.foreign_keys': [
          {
            constraint_name: 'fk_user_company',
            columns: 'companyId',
            referenced_table: 'Company',
            referenced_columns: 'id',
            delete_rule: 'SET_NULL',
            update_rule: 'NO_ACTION',
          },
        ],
      }),
    );

    expect((await introspector.getTableSchema('User'))?.foreignKeys?.[0]).toMatchObject({
      name: 'fk_user_company',
      columns: ['companyId'],
      onDelete: 'SET NULL',
      onUpdate: 'NO ACTION',
    });
  });

  it('should read a composite index in key order, excluding the primary one', async () => {
    const introspector = new MsSqlSchemaIntrospector(
      poolAnswering({
        'COUNT(*) as count': [{ count: 1 }],
        'sys.index_columns ic ON ic.object_id = i.object_id': [
          { index_name: 'ix_name_email', columns: 'name,email', is_unique: true },
        ],
      }),
    );

    expect((await introspector.getTableSchema('User'))?.indexes).toEqual([
      { name: 'ix_name_email', entries: [{ column: 'name' }, { column: 'email' }], unique: true },
    ]);
  });

  /** The 2025-only `vector_dimensions` column would break the query on the 2017 floor. */
  it('should read a VECTOR dimension back from its storage size', async () => {
    const introspector = new MsSqlSchemaIntrospector(
      poolAnswering({
        'COUNT(*) as count': [{ count: 1 }],
        'sys.columns': [
          {
            column_name: 'vec',
            data_type: 'vector',
            max_length: 6152,
            is_nullable: true,
            is_identity: false,
            column_default: null,
          },
        ],
      }),
    );

    expect((await introspector.getTableSchema('T'))?.columns[0]).toMatchObject({
      name: 'vec',
      type: 'VECTOR',
      length: 1536,
    });
  });
});
