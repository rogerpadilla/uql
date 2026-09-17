import { expect } from 'vitest';
import { PgQuerierPool } from '../../postgres/pgQuerierPool.js';
import { createSpec, postgresConnection } from '../../test/index.js';
import type { QuerierPool, SqlQuerier } from '../../type/index.js';
import { AbstractIntrospectorIt, INTROSPECT_TABLES } from './abstractIntrospector-test.js';
import { PostgresSchemaIntrospector } from './postgresIntrospector.js';

/** An introspector reading on one given connection, so a test can drive what its snapshot sees. */
class PinnedIntrospector extends PostgresSchemaIntrospector {
  constructor(
    pool: QuerierPool,
    private readonly pinned: SqlQuerier,
  ) {
    super(pool);
  }

  protected override withSqlQuerier<T>(task: (querier: SqlQuerier) => Promise<T>): Promise<T> {
    return task(this.pinned);
  }
}

class PostgresIntrospectorIt extends AbstractIntrospectorIt {
  constructor() {
    const pool = new PgQuerierPool(postgresConnection());
    super(pool, new PostgresSchemaIntrospector(pool));
  }

  override async addDialectSpecificColumnsA(querier: SqlQuerier): Promise<void> {
    await querier.run(`ALTER TABLE ${INTROSPECT_TABLES.A} ADD COLUMN tags TEXT[]`);
    // Raw DDL rather than the builder, so what is asserted is what Postgres stored and not what UQL
    // would have emitted.
    await querier.run(`CREATE UNIQUE INDEX a_lower_name_idx ON ${INTROSPECT_TABLES.A} (lower(name))`);
    await querier.run(`CREATE INDEX a_live_status_idx ON ${INTROSPECT_TABLES.A} (status) WHERE is_enabled`);
    await querier.run(`CREATE INDEX a_score_covering_idx ON ${INTROSPECT_TABLES.A} (score DESC) INCLUDE (status)`);
    await querier.run(`ALTER TABLE ${INTROSPECT_TABLES.A} ADD COLUMN slug TEXT UNIQUE`);
    // Longer than 63 characters, which is where the `name` catalogue type would clip it.
    await querier.run(
      `CREATE INDEX a_long_expression_idx ON ${INTROSPECT_TABLES.A} ((to_tsvector('english', name || ' ' || status)))`,
    );
  }

  async shouldReadAnExpressionLongerThanAnIdentifier() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const index = this.getIndex(schema, 'a_long_expression_idx');
    expect(index.entries[0].column).toBe("to_tsvector('english'::regconfig, (name || ' '::text) || status::text)");
  }

  async shouldNotReportTheIndexBehindAUniqueConstraint() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    // `@Field({ unique })` emits the constraint, never the index Postgres builds to enforce it.
    expect(schema.indexes?.map((index) => index.name)).toEqual([
      'a_live_status_idx',
      'a_long_expression_idx',
      'a_lower_name_idx',
      'a_score_covering_idx',
    ]);
  }

  async shouldIntrospectExpressionIndex() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const index = this.getIndex(schema, 'a_lower_name_idx');
    expect(index.entries).toEqual([{ column: 'lower(name)', expression: true, order: 'asc', nulls: 'last' }]);
    expect(index.unique).toBe(true);
    expect(index.type).toBe('btree');
  }

  async shouldIntrospectPartialIndexPredicate() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const index = this.getIndex(schema, 'a_live_status_idx');
    expect(index.where).toBe('is_enabled');
    expect(index.entries.map((entry) => entry.column)).toEqual(['status']);
  }

  async shouldIntrospectCoveringIndexAndStoredOrder() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    const index = this.getIndex(schema, 'a_score_covering_idx');
    expect(index.entries).toEqual([{ column: 'score', order: 'desc', nulls: 'first' }]);
    expect(index.include).toEqual(['status']);
  }

  /** A method UQL has no index type for, `spgist` here, is reported as no type. */
  async shouldReadAnIndexOperatorClassAndAccessMethod() {
    const schema = await this.probe('probe_index_kinds', async (querier, table) => {
      await querier.run(`CREATE TABLE ${table} (code TEXT, tags TEXT[], spot POINT)`);
      await querier.run(`CREATE INDEX probe_code_idx ON ${table} (code text_pattern_ops NULLS FIRST)`);
      await querier.run(`CREATE INDEX probe_tags_idx ON ${table} USING gin (tags)`);
      await querier.run(`CREATE INDEX probe_spot_idx ON ${table} USING spgist (spot)`);
    });

    expect(schema.indexes).toEqual([
      {
        name: 'probe_code_idx',
        unique: false,
        type: 'btree',
        entries: [{ column: 'code', order: 'asc', nulls: 'first', opsClass: 'text_pattern_ops' }],
      },
      { name: 'probe_spot_idx', unique: false, entries: [{ column: 'spot', order: 'asc', nulls: 'last' }] },
      {
        name: 'probe_tags_idx',
        unique: false,
        type: 'gin',
        entries: [{ column: 'tags', order: 'asc', nulls: 'last' }],
      },
    ]);
  }

  async shouldIntrospectArrayColumn() {
    const schema = await this.getTableSchema(INTROSPECT_TABLES.A);

    expect(this.getColumn(schema, 'tags').type).toBe('TEXT[]');
  }

  async shouldReadAnEnumColumnByItsTypeName() {
    await this.pool.withQuerier((querier) => querier.run(`CREATE TYPE probe_mood AS ENUM ('calm', 'busy')`));
    try {
      const schema = await this.probe('probe_enum', (querier, table) =>
        querier.run(`CREATE TABLE ${table} (mood probe_mood)`),
      );

      expect(this.getColumn(schema, 'mood').type).toBe('PROBE_MOOD');
    } finally {
      await this.pool.withQuerier((querier) => querier.run('DROP TYPE probe_mood'));
    }
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

  /** A `SERIAL` numbers itself through `nextval`, the way an identity column does without one. */
  async shouldReadEveryDefaultSpelling() {
    const schema = await this.probe('probe_defaults', (querier, table) =>
      querier.run(/*sql*/ `
        CREATE TABLE ${table} (
          quoted TEXT DEFAULT 'it''s', negative INTEGER DEFAULT -3, fraction NUMERIC(6, 2) DEFAULT -12.5,
          truthy BOOLEAN DEFAULT true, blank VARCHAR(5) DEFAULT NULL, stamped TIMESTAMP DEFAULT now(),
          empty TEXT[] DEFAULT '{}', counter SERIAL
        )
      `),
    );

    expect(Object.fromEntries(schema.columns.map((column) => [column.name, column.defaultValue]))).toEqual({
      quoted: "it's",
      negative: -3,
      fraction: -12.5,
      truthy: true,
      blank: null,
      stamped: 'now()',
      empty: '{}',
      counter: "nextval('probe_defaults_counter_seq')",
    });
    expect(this.getColumn(schema, 'counter').isAutoIncrement).toBe(true);
  }

  /** A table of the same name in the default schema is neither read nor in the way. */
  async shouldReadOnlyTheSchemaItWasGiven() {
    const table = `uql_probe.${INTROSPECT_TABLES.A}`;
    const querier = await this.pool.getQuerier();
    try {
      await querier.run('CREATE SCHEMA uql_probe');
      await querier.run(
        `CREATE TABLE ${table} (id INTEGER CONSTRAINT probe_pk PRIMARY KEY, code INTEGER UNIQUE, note TEXT)`,
      );
      await querier.run(`CREATE INDEX probe_note_idx ON ${table} (note)`);
      await querier.run(`COMMENT ON COLUMN ${table}.note IS 'probed'`);

      const named = await new PostgresSchemaIntrospector(this.pool, 'uql_probe').getTableSchema(INTROSPECT_TABLES.A);
      const own = await this.getTableSchema(INTROSPECT_TABLES.A);

      expect(named).toMatchObject({
        primaryKey: ['id'],
        primaryKeyName: 'probe_pk',
        indexes: [{ name: 'probe_note_idx' }],
        foreignKeys: [],
      });
      expect(named?.columns.map(({ name, isUnique, comment }) => ({ name, isUnique, comment }))).toEqual([
        { name: 'id', isUnique: false, comment: undefined },
        { name: 'code', isUnique: true, comment: undefined },
        { name: 'note', isUnique: false, comment: 'probed' },
      ]);
      expect(own.columns.map((column) => column.name)).toContain('status');
    } finally {
      await querier.run('DROP SCHEMA uql_probe CASCADE');
      await querier.release();
    }
  }

  /**
   * A table another connection dropped is read out of the snapshot that still lists it, never raised:
   * `introspect()` scans a database other things are changing. A repeatable read transaction is that
   * race made deterministic - `information_schema` still answers from its snapshot while name
   * resolution answers from the live catalogue.
   */
  async shouldReadATableDroppedAfterTheSnapshotThatLeftIt() {
    const reader = await this.pool.getQuerier();
    const writer = await this.pool.getQuerier();
    try {
      await writer.run('CREATE TABLE probe_vanishing (id INTEGER PRIMARY KEY, note TEXT)');
      await reader.beginTransaction({ isolationLevel: 'repeatable read' });
      await reader.all('SELECT 1');
      await writer.run('DROP TABLE probe_vanishing');

      const schema = await new PinnedIntrospector(this.pool, reader).getTableSchema('probe_vanishing');

      expect(schema?.columns.map((column) => column.name)).toEqual(['id', 'note']);
    } finally {
      await reader.rollbackTransaction();
      await writer.run('DROP TABLE IF EXISTS probe_vanishing');
      await reader.release();
      await writer.release();
    }
  }

  async shouldEscapeTheSchemaItWasGiven() {
    await expect(new PostgresSchemaIntrospector(this.pool, "uql'probe").getTableNames()).resolves.toEqual([]);
  }
}

createSpec(new PostgresIntrospectorIt());
