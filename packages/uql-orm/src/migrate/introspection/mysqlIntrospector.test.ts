import { expect } from 'vitest';
import { MySql2QuerierPool } from '../../mysql/mysql2QuerierPool.js';
import { createSpec } from '../../test/index.js';
import type { SqlQuerier } from '../../type/index.js';
import { AbstractIntrospectorIt, INTROSPECT_TABLES } from './abstractIntrospector-test.js';
import { MysqlSchemaIntrospector } from './mysqlIntrospector.js';

/**
 * MySQL Schema Introspector Integration Tests
 *
 * Runs against a real MySQL database (docker-compose service).
 * Tests all aspects of schema introspection including:
 * - Table discovery, columns, types
 * - Primary keys, foreign keys with referential actions
 * - Indexes (single, composite, unique)
 * - Default values, nullability
 * - MySQL-specific features (AUTO_INCREMENT, column comments, unsigned types)
 */
class MysqlIntrospectorIt extends AbstractIntrospectorIt {
  constructor() {
    const pool = new MySql2QuerierPool({
      host: '0.0.0.0',
      port: 3316,
      user: 'test',
      password: 'test',
      database: 'test',
    });
    super(pool, new MysqlSchemaIntrospector(pool));
  }

  // ============================================================================
  // MySQL-Specific Hooks
  // ============================================================================

  /**
   * MySQL requires disabling FK checks before dropping tables.
   */
  override async beforeDropTables(querier: SqlQuerier): Promise<void> {
    await querier.run('SET FOREIGN_KEY_CHECKS = 0');
  }

  /**
   * Re-enable FK checks after dropping tables.
   */
  override async afterDropTables(querier: SqlQuerier): Promise<void> {
    await querier.run('SET FOREIGN_KEY_CHECKS = 1');
  }

  // ============================================================================
  // MySQL-Specific Tests
  // ============================================================================

  async shouldIntrospectAutoIncrementColumn() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const idCol = this.getColumn(schema, 'id');
    expect(idCol.isAutoIncrement).toBe(true);
  }

  async shouldIntrospectDecimalColumn() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const amountCol = this.getColumn(schema, 'amount');
    expect(amountCol.type.toUpperCase()).toContain('DECIMAL');
    expect(amountCol.precision).toBe(10);
    expect(amountCol.scale).toBe(2);
  }

  async shouldIntrospectVarcharLength() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const statusCol = this.getColumn(schema, 'status');
    expect(statusCol.length).toBe(50);
  }

  async shouldIntrospectTinyintAsBoolean() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const isEnabledCol = this.getColumn(schema, 'is_enabled');
    expect(isEnabledCol.type.toUpperCase()).toContain('TINYINT');
    expect(isEnabledCol.defaultValue).toBe(1);
  }

  async shouldIntrospectTimestampDefault() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const createdAtCol = this.getColumn(schema, 'created_at');
    const type = createdAtCol.type.toUpperCase();
    expect(type).toBe('DATETIME');
    expect(createdAtCol.defaultValue).toBe('CURRENT_TIMESTAMP');
  }
}

createSpec(new MysqlIntrospectorIt());
