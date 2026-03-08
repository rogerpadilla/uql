import { expect } from 'vitest';
import { PgQuerierPool } from '../../postgres/pgQuerierPool.js';
import { createSpec } from '../../test/index.js';
import type { SqlQuerier } from '../../type/index.js';
import { AbstractIntrospectorIt, INTROSPECT_TABLES } from './abstractIntrospector-test.js';
import { PostgresSchemaIntrospector } from './postgresIntrospector.js';

/**
 * PostgreSQL Schema Introspector Integration Tests
 *
 * Runs against a real PostgreSQL database (docker-compose service).
 * Tests all aspects of schema introspection including:
 * - Table discovery, columns, types
 * - Primary keys, foreign keys with referential actions
 * - Indexes (single, composite, unique)
 * - Default values, nullability
 * - PostgreSQL-specific features (arrays, generated columns)
 */
class PostgresIntrospectorIt extends AbstractIntrospectorIt {
  constructor() {
    const pool = new PgQuerierPool({
      host: '0.0.0.0',
      port: 5442,
      user: 'test',
      password: 'test',
      database: 'test',
    });
    super(pool, new PostgresSchemaIntrospector(pool));
  }

  // ============================================================================
  // PostgreSQL-Specific Hooks
  // ============================================================================

  /**
   * Add PostgreSQL-specific columns (arrays) to table A.
   */
  override async addDialectSpecificColumnsA(querier: SqlQuerier): Promise<void> {
    await querier.run(`ALTER TABLE ${INTROSPECT_TABLES.A} ADD COLUMN tags TEXT[]`);
  }

  // ============================================================================
  // PostgreSQL-Specific Tests
  // ============================================================================

  async shouldIntrospectArrayColumn() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const tagsCol = schema.columns.find((c) => c.name === 'tags');
    expect(tagsCol).toBeDefined();
    expect(tagsCol?.type.toUpperCase()).toContain('TEXT');
  }

  async shouldIntrospectIdentityColumn() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const idCol = this.getColumn(schema, 'id');
    expect(idCol.isAutoIncrement).toBe(true);
  }

  async shouldIntrospectBooleanColumn() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const isEnabledCol = this.getColumn(schema, 'is_enabled');
    expect(isEnabledCol.type.toUpperCase()).toBe('BOOLEAN');
    expect(isEnabledCol.defaultValue).toBe(true);
  }

  async shouldIntrospectTimestampDefault() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const createdAtCol = this.getColumn(schema, 'created_at');
    expect(createdAtCol.type.toUpperCase()).toContain('TIMESTAMP');
    expect(createdAtCol.defaultValue).toBe('CURRENT_TIMESTAMP');
  }

  async shouldIntrospectVarcharLength() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const statusCol = this.getColumn(schema, 'status');
    expect(statusCol.length).toBe(50);
  }
}

createSpec(new PostgresIntrospectorIt());
