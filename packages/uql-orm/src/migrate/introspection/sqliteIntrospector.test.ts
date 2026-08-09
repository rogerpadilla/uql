import { expect } from 'vitest';
import type { TypeCategory } from '../../schema/types.js';
import { Sqlite3QuerierPool } from '../../sqlite/sqliteQuerierPool.js';
import { createMockQuerierPool, createSpec } from '../../test/index.js';
import { AbstractIntrospectorIt, INTROSPECT_TABLES } from './abstractIntrospector-test.js';
import { SqliteSchemaIntrospector } from './sqliteIntrospector.js';

class SqliteIntrospectorIt extends AbstractIntrospectorIt {
  constructor() {
    const pool = new Sqlite3QuerierPool(':memory:');
    super(pool, new SqliteSchemaIntrospector(pool));
  }

  /** SQLite has no date/time type: a timestamp is stored, and read back, as `TEXT`. */
  protected override expectedTimestampCategory(): TypeCategory {
    return 'string';
  }

  async shouldIntrospectIntegerPrimaryKeyAsAutoIncrement() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const idCol = this.getColumn(schema, 'id');
    expect(idCol.isPrimaryKey).toBe(true);
    expect(idCol.isAutoIncrement).toBe(true);
  }

  /**
   * `PRAGMA index_info` names an expression entry `null`, which used to reach the diff as a column
   * called `null`. SQLite reports no expression text (only `sqlite_master.sql` has it), so such an
   * index is left out rather than described wrongly.
   */
  async shouldSkipAnExpressionIndexRatherThanNameItNull() {
    const querier = await this.pool.getQuerier();
    try {
      const table = querier.dialect.escapeId(INTROSPECT_TABLES.A);
      await querier.run(`CREATE INDEX idx_expr_name ON ${table} (lower(${querier.dialect.escapeId('name')}))`);

      const schema = await this.getTableSchema(INTROSPECT_TABLES.A);
      const names = schema.indexes?.map((index) => index.name) ?? [];

      expect(names).not.toContain('idx_expr_name');
      expect(schema.indexes?.flatMap((index) => index.entries.map((column) => column.column))).not.toContain(null);
    } finally {
      await querier.run('DROP INDEX idx_expr_name');
      await querier.release();
    }
  }

  /**
   * Describing one table needs `table_info` for its columns, `table_info` again for its primary key, and
   * `index_list`/`index_info` for both its indexes and its single-column unique constraints. Each of
   * those statements is sent once - on D1 and Turso every one is an HTTP round trip.
   */
  async shouldSendEachIntrospectionStatementOnce() {
    const querier = await this.pool.getQuerier();
    const sent: string[] = [];
    const all = querier.all.bind(querier);
    querier.all = ((sql: string, params?: unknown[]) => {
      sent.push(sql);
      return all(sql, params);
    }) as typeof querier.all;

    try {
      // A real pool over the instrumented querier: spreading `this.pool` dropped the prototype, so the
      // introspector's `withQuerier` was not there. The pool releases what it hands out.
      const pool = createMockQuerierPool(this.pool.dialect, async () => querier);
      await new SqliteSchemaIntrospector(pool).getTableSchema(INTROSPECT_TABLES.A);

      expect(sent.length).toBe(new Set(sent).size);
    } finally {
      querier.all = all;
    }
  }

  async shouldIntrospectTextDefault() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const statusCol = this.getColumn(schema, 'status');
    expect(statusCol.type).toBe('TEXT');
    expect(statusCol.defaultValue).toBe('active');
  }

  async shouldIntrospectIntegerDefault() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const isEnabledCol = this.getColumn(schema, 'is_enabled');
    expect(isEnabledCol.type).toBe('INTEGER');
    expect(isEnabledCol.defaultValue).toBe(1);
  }

  async shouldIntrospectTimestampAsText() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const createdAtCol = this.getColumn(schema, 'created_at');
    expect(createdAtCol.type).toBe('TEXT');
    expect(createdAtCol.defaultValue).toBe('CURRENT_TIMESTAMP');
  }

  async shouldHandleTableWithNoForeignKeys() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    expect(schema.foreignKeys).toEqual([]);
  }
}

createSpec(new SqliteIntrospectorIt());
