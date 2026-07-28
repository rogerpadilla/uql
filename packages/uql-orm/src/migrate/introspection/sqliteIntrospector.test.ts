import { expect } from 'vitest';
import { Sqlite3QuerierPool } from '../../sqlite/sqliteQuerierPool.js';
import { createSpec } from '../../test/index.js';
import type { SqlQuerier } from '../../type/index.js';
import { AbstractIntrospectorIt, INTROSPECT_TABLES } from './abstractIntrospector-test.js';
import { SqliteSchemaIntrospector } from './sqliteIntrospector.js';

class SqliteIntrospectorIt extends AbstractIntrospectorIt {
  constructor() {
    const pool = new Sqlite3QuerierPool(':memory:');
    super(pool, new SqliteSchemaIntrospector(pool));
  }

  /** SQLite requires enabling foreign keys with PRAGMA. */
  override async beforeCreateTables(querier: SqlQuerier): Promise<void> {
    await querier.run('PRAGMA foreign_keys = ON');
  }

  async shouldIntrospectIntegerPrimaryKeyAsAutoIncrement() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const idCol = this.getColumn(schema, 'id');
    expect(idCol.isPrimaryKey).toBe(true);
    expect(idCol.isAutoIncrement).toBe(true);
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
