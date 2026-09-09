import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineEntity } from '../entity/index.js';
import { detectDrift } from '../migrate/drift/index.js';
import { PostgresSchemaIntrospector } from '../migrate/introspection/postgresIntrospector.js';
import { buildSchemaAST } from '../schema/schemaASTBuilder.js';
import { provisioningTimeout } from '../test/index.js';
import { PgQuerierPool } from './pgQuerierPool.js';
import { PostgresDialect } from './postgresDialect.js';

const TABLE = 'pg_column_drift';
/** Its own namespace: another suite introspecting `public` while this one drops its table reads a
 * relation that is already gone, which Postgres reports as a missing OID. */
const SCHEMA = 'drift_probe';

/**
 * Whether two column types agree is the engine's answer, not one the canonical values can give: an
 * unlengthed `String` is `VARCHAR(255)` on MySQL and `TEXT` on Postgres. Only a real catalogue can
 * say which, so the entity here is compared against a column this test wrote in SQL itself.
 */
describe('PostgreSQL column type drift', () => {
  const pool = new PgQuerierPool({ host: '0.0.0.0', port: 5442, user: 'test', password: 'test', database: 'test' });
  const dialect = new PostgresDialect({});

  const driftFor = async (length?: number) => {
    class Row {
      id?: number;
      title?: string;
    }
    defineEntity(Row, {
      name: TABLE,
      schema: SCHEMA,
      fields: { id: { type: Number, isId: true }, title: { type: String, length } },
    });
    const actual = await new PostgresSchemaIntrospector(pool, SCHEMA).introspect([TABLE]);
    const expected = buildSchemaAST([Row], { namingStrategy: dialect.namingStrategy });
    return detectDrift(expected, actual, { dialect }).drifts.filter((drift) => drift.type === 'type_mismatch');
  };

  beforeAll(async () => {
    await pool.withQuerier(async (querier) => {
      await querier.run(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await querier.run(`CREATE SCHEMA "${SCHEMA}"`);
      await querier.run(`CREATE TABLE "${SCHEMA}"."${TABLE}" (id BIGINT PRIMARY KEY, title VARCHAR(255))`);
    });
  }, provisioningTimeout);

  afterAll(async () => {
    await pool.withQuerier((querier) => querier.run(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`));
    await pool.end();
  }, provisioningTimeout);

  it('reports the VARCHAR(255) the entity would have created as TEXT', async () => {
    const drifts = await driftFor();

    expect(drifts).toHaveLength(1);
    expect(drifts[0].column).toBe('title');
    expect(drifts[0].expected).toBe('TEXT');
    expect(drifts[0].actual).toBe('VARCHAR(255)');
  });

  it('reports nothing once the entity states the length the column has', async () => {
    expect(await driftFor(255)).toEqual([]);
  });
});
