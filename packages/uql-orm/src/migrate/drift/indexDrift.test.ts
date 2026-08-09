import { afterAll, describe, expect, it } from 'vitest';
import { CockroachDialect } from '../../cockroachdb/cockroachDialect.js';
import { CrdbQuerierPool } from '../../cockroachdb/crdbQuerierPool.js';
import { PostgresDialect } from '../../dialect/index.js';
import { Entity, Field, Id, Index } from '../../entity/index.js';
import { PgQuerierPool } from '../../postgres/pgQuerierPool.js';
import { buildSchemaAST } from '../../schema/schemaASTBuilder.js';
import { raw } from '../../util/index.js';
import { CockroachSchemaIntrospector, PostgresSchemaIntrospector } from '../introspection/postgresIntrospector.js';
import { Migrator } from '../migrator.js';
import { detectDrift } from './driftDetector.js';

const TABLE = 'drift_index_user';

/**
 * Everything an index carries that Postgres reprints in its own words: an expression, a partial
 * predicate, a stored order, `INCLUDE` columns, an operator class.
 */
@Index([raw('lower("email")')], { unique: true, where: '"deletedAt" IS NULL', name: 'idx_drift_email_live' })
@Index(['status', { column: 'createdAt', order: 'desc' }], { name: 'idx_drift_status_recent' })
@Index(['tenantId'], { include: ['status'], name: 'idx_drift_tenant_covering' })
@Index([{ column: 'data', opsClass: 'jsonb_path_ops' }], { type: 'gin', name: 'idx_drift_data' })
@Entity({ name: TABLE })
class DriftIndexUser {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) email?: string;
  @Field({ type: String }) status?: string;
  @Field({ type: Number }) tenantId?: number;
  @Field({ type: Date }) createdAt?: Date;
  @Field({ type: 'jsonb' }) data?: object;
  @Field({ type: Date, softDelete: true }) deletedAt?: Date;
}

/** The same table, with one index no longer unique and one covering column dropped. */
@Index([raw('lower("email")')], { where: '"deletedAt" IS NULL', name: 'idx_drift_email_live' })
@Index(['tenantId'], { name: 'idx_drift_tenant_covering' })
@Entity({ name: TABLE })
class DriftIndexUserEdited {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) email?: string;
  @Field({ type: String }) status?: string;
  @Field({ type: Number }) tenantId?: number;
  @Field({ type: Date }) createdAt?: Date;
  @Field({ type: 'jsonb' }) data?: object;
  @Field({ type: Date, softDelete: true }) deletedAt?: Date;
}

/**
 * The round trip that every piece of index comparison has to survive: emit the DDL, read it back out
 * of the catalogue, and compare it with the entity it came from. Postgres reprints an expression and
 * a predicate in its own normalized form, so anything the comparison fails to fold away shows up
 * here as drift that no migration could ever settle.
 */
describe('index drift (PostgreSQL)', () => {
  const pool = new PgQuerierPool({ host: '0.0.0.0', port: 5442, user: 'test', password: 'test', database: 'test' });
  const dialect = new PostgresDialect();
  const introspector = new PostgresSchemaIntrospector(pool);

  const driftOf = async (entity: typeof DriftIndexUser) => {
    const actual = await introspector.introspect();
    const expected = buildSchemaAST([entity], { namingStrategy: dialect.namingStrategy });
    const report = detectDrift(expected, actual, { dialect, indexFacets: introspector.indexFacets });
    return report.drifts.filter((drift) => drift.table === TABLE);
  };

  afterAll(async () => {
    await pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS "${TABLE}"`));
    await pool.end();
  });

  it('reports nothing for the schema it just created', async () => {
    await pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS "${TABLE}"`));
    await new Migrator(pool, { entities: [DriftIndexUser] }).autoSync({ logging: false });

    expect(await driftOf(DriftIndexUser)).toEqual([]);
  });

  it('reports the indexes whose definition the entity changed', async () => {
    const drifts = (await driftOf(DriftIndexUserEdited)).filter((drift) => drift.type === 'index_mismatch');

    expect(drifts.map((drift) => drift.index).sort()).toEqual(['idx_drift_email_live', 'idx_drift_tenant_covering']);
    expect(drifts.find((drift) => drift.index === 'idx_drift_email_live')?.details).toContain('unique');
    expect(drifts.find((drift) => drift.index === 'idx_drift_tenant_covering')?.details).toContain('include');
  });
});

const CRDB_TABLE = 'drift_index_crdb';

/**
 * CockroachDB cannot express an operator class or a nulls order, so its entity declares neither. The
 * unique index is the point of the suite: CRDB registers a `UNIQUE` constraint for a plain
 * `CREATE UNIQUE INDEX` too, so a catalogue filter written for Postgres hides it and reports it
 * missing on every run.
 */
@Index([raw('lower("email")')], { unique: true, where: '"deletedAt" IS NULL', name: 'idx_crdb_email_live' })
@Index(['status'], { unique: true, name: 'idx_crdb_status_unique' })
@Index(['tenantId'], { include: ['status'], name: 'idx_crdb_tenant_covering' })
@Entity({ name: CRDB_TABLE })
class CrdbIndexUser {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) email?: string;
  @Field({ type: String }) status?: string;
  @Field({ type: Number }) tenantId?: number;
  @Field({ type: Date, softDelete: true }) deletedAt?: Date;
}

describe('index drift (CockroachDB)', () => {
  const pool = new CrdbQuerierPool({ host: '0.0.0.0', port: 26257, user: 'root', database: 'defaultdb' });
  const dialect = new CockroachDialect();
  const introspector = new CockroachSchemaIntrospector(pool);

  afterAll(async () => {
    await pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS "${CRDB_TABLE}"`));
    await pool.end();
  });

  it('reports nothing for the schema it just created, unique indexes included', async () => {
    await pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS "${CRDB_TABLE}"`));
    await new Migrator(pool, { entities: [CrdbIndexUser] }).autoSync({ logging: false });

    const actual = await introspector.introspect();
    expect(
      actual
        .getTable(CRDB_TABLE)
        ?.indexes.map((index) => index.name)
        .sort(),
    ).toEqual(['idx_crdb_email_live', 'idx_crdb_status_unique', 'idx_crdb_tenant_covering']);

    const expected = buildSchemaAST([CrdbIndexUser], { namingStrategy: dialect.namingStrategy });
    const report = detectDrift(expected, actual, { dialect, indexFacets: introspector.indexFacets });
    expect(report.drifts.filter((drift) => drift.table === CRDB_TABLE)).toEqual([]);
  });
});
