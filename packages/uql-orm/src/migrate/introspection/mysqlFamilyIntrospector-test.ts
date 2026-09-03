import { expect } from 'vitest';
import type { SqlQuerier } from '../../type/index.js';
import { AbstractIntrospectorIt, INTROSPECT_TABLES } from './abstractIntrospector-test.js';

/**
 * Shared expectations for MySQL-wire-compatible introspectors (MySQL, MariaDB): both go through
 * {@link MysqlSchemaIntrospector} (which `MariadbSchemaIntrospector` extends) and need FK
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

  /**
   * MariaDB has no JSON type: `JSON` there is `LONGTEXT` plus a `json_valid()` check, so the column
   * reads back as `longtext` unless the introspector looks that check up. Both engines have to
   * answer the same thing - what the column was declared as - or every JSON column on MariaDB drifts
   * against the entity that declared it.
   */
  protected override async addDialectSpecificColumnsA(querier: SqlQuerier): Promise<void> {
    await querier.run(`ALTER TABLE ${INTROSPECT_TABLES.A} ADD COLUMN kind JSON NULL, ADD COLUMN notes LONGTEXT NULL`);
  }

  async shouldIntrospectJsonColumn() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    expect(this.getColumn(schema, 'kind').type.toUpperCase()).toBe('JSON');
  }

  /**
   * The column MariaDB stores a JSON one as. It has no `json_valid()` check, which is the whole
   * difference, and reading it as JSON would turn a plain text column into one on every round trip.
   */
  async shouldIntrospectLongtextColumnAsLongtext() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    expect(this.getColumn(schema, 'notes').type.toUpperCase()).toBe('LONGTEXT');
  }

  async shouldIntrospectTimestampDefault() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const createdAtCol = this.getColumn(schema, 'created_at');
    expect(createdAtCol.type.toUpperCase()).toBe('DATETIME');
    expect(createdAtCol.defaultValue).toBe('CURRENT_TIMESTAMP');
  }
}
