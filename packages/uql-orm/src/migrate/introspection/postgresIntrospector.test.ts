import { expect } from 'vitest';
import { PgQuerierPool } from '../../postgres/pgQuerierPool.js';
import { createSpec } from '../../test/index.js';
import type { SqlQuerier } from '../../type/index.js';
import { AbstractIntrospectorIt, INTROSPECT_TABLES } from './abstractIntrospector-test.js';
import { PostgresSchemaIntrospector } from './postgresIntrospector.js';

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

  override async addDialectSpecificColumnsA(querier: SqlQuerier): Promise<void> {
    await querier.run(`ALTER TABLE ${INTROSPECT_TABLES.A} ADD COLUMN tags TEXT[]`);
    // Raw DDL rather than the builder, so what is asserted is what Postgres stored and not what UQL
    // would have emitted.
    await querier.run(`CREATE UNIQUE INDEX idx_a_lower_name ON ${INTROSPECT_TABLES.A} (lower(name))`);
    await querier.run(`CREATE INDEX idx_a_live_status ON ${INTROSPECT_TABLES.A} (status) WHERE is_enabled`);
    await querier.run(`CREATE INDEX idx_a_score_covering ON ${INTROSPECT_TABLES.A} (score DESC) INCLUDE (status)`);
    await querier.run(`ALTER TABLE ${INTROSPECT_TABLES.A} ADD COLUMN slug TEXT UNIQUE`);
    // Longer than 63 characters, which is where the `name` catalogue type would clip it.
    await querier.run(
      `CREATE INDEX idx_a_long_expression ON ${INTROSPECT_TABLES.A} ((to_tsvector('english', name || ' ' || status)))`,
    );
  }

  async shouldReadAnExpressionLongerThanAnIdentifier() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const index = this.getIndex(schema, 'idx_a_long_expression');
    expect(index.entries[0].column).toBe("to_tsvector('english'::regconfig, (name || ' '::text) || status::text)");
  }

  async shouldNotReportTheIndexBehindAUniqueConstraint() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    // `@Field({ unique })` emits the constraint, never the index Postgres builds to enforce it.
    expect(schema.indexes?.map((index) => index.name)).toEqual([
      'idx_a_live_status',
      'idx_a_long_expression',
      'idx_a_lower_name',
      'idx_a_score_covering',
    ]);
  }

  async shouldIntrospectExpressionIndex() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const index = this.getIndex(schema, 'idx_a_lower_name');
    expect(index.entries).toEqual([{ column: 'lower(name)', expression: true, order: 'asc', nulls: 'last' }]);
    expect(index.unique).toBe(true);
    expect(index.type).toBe('btree');
  }

  async shouldIntrospectPartialIndexPredicate() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const index = this.getIndex(schema, 'idx_a_live_status');
    expect(index.where).toBe('is_enabled');
    expect(index.entries.map((entry) => entry.column)).toEqual(['status']);
  }

  async shouldIntrospectCoveringIndexAndStoredOrder() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const index = this.getIndex(schema, 'idx_a_score_covering');
    expect(index.entries).toEqual([{ column: 'score', order: 'desc', nulls: 'first' }]);
    expect(index.include).toEqual(['status']);
  }

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
