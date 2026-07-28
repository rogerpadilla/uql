import { expect } from 'vitest';
import type { SqlQuerier } from '../../type/index.js';
import { AbstractIntrospectorIt, INTROSPECT_TABLES } from './abstractIntrospector-test.js';

/**
 * Shared expectations for MySQL-wire-compatible introspectors (MySQL, MariaDB): both go through
 * {@link MysqlSchemaIntrospector} (`MariadbSchemaIntrospector` is an alias for it) and need FK
 * checks disabled around DDL.
 */
export abstract class MySqlFamilyIntrospectorIt extends AbstractIntrospectorIt {
  override async beforeDropTables(querier: SqlQuerier): Promise<void> {
    await querier.run('SET FOREIGN_KEY_CHECKS = 0');
  }

  override async afterDropTables(querier: SqlQuerier): Promise<void> {
    await querier.run('SET FOREIGN_KEY_CHECKS = 1');
  }

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
    expect(createdAtCol.type.toUpperCase()).toBe('DATETIME');
    expect(createdAtCol.defaultValue).toBe('CURRENT_TIMESTAMP');
  }
}
