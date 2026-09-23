import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CrdbQuerierPool } from '../../cockroachdb/crdbQuerierPool.js';
import { assertDefined, cockroachConnection, provisioningTimeout } from '../../test/index.js';
import { CockroachSchemaIntrospector } from './postgresIntrospector.js';

const TABLE = 'crdb_introspect_generated';

/**
 * CockroachDB answers the Postgres catalogue queries, so the shared suite runs elsewhere; what needs
 * its own reading is where the two catalogues could differ. A generated column is one: `attgenerated`
 * is what parts a stored one from a virtual one, and nothing else here asks CockroachDB for it.
 */
describe('column introspection (CockroachDB)', () => {
  const pool = new CrdbQuerierPool(cockroachConnection());
  const introspector = new CockroachSchemaIntrospector(pool);

  beforeAll(async () => {
    await pool.withQuerier(async (querier) => {
      await querier.run(`DROP TABLE IF EXISTS "${TABLE}"`);
      await querier.run(
        `CREATE TABLE "${TABLE}" (id INT PRIMARY KEY, qty INT,
           doubled INT AS (qty * 2) STORED, tripled INT AS (qty * 3) VIRTUAL)`,
      );
    });
  }, provisioningTimeout);

  afterAll(async () => {
    await pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS "${TABLE}"`));
    await pool.end();
  }, provisioningTimeout);

  const column = async (name: string) => {
    const schema = await introspector.getTableSchema(TABLE);
    const found = schema?.columns.find((it) => it.name === name);
    assertDefined(found, `column ${name} not found`);
    return found;
  };

  it('should read a stored generated column with its expression', async () => {
    expect((await column('doubled')).generatedAs).toBe('qty * 2');
  });

  it('should leave a virtual generated column out, which uql cannot declare', async () => {
    expect((await column('tripled')).generatedAs).toBe(undefined);
  });

  it('should leave a plain column ungenerated', async () => {
    expect((await column('qty')).generatedAs).toBe(undefined);
  });
});

const VECTOR_TABLE = 'crdb_introspect_vector';

/**
 * CockroachDB reports every index's access method as `prefix` and no operator class, so a vector index,
 * its distance and its prefix columns are read off its definition instead.
 */
describe('vector index introspection (CockroachDB)', () => {
  const pool = new CrdbQuerierPool(cockroachConnection());

  afterAll(async () => {
    await pool.withQuerier((querier) => querier.run(`DROP TABLE IF EXISTS "${VECTOR_TABLE}"`));
    await pool.end();
  }, provisioningTimeout);

  it(
    'should read a vector index as one, its distance its class names or else the default L2',
    async () => {
      await pool.withQuerier(async (querier) => {
        await querier.run(`DROP TABLE IF EXISTS "${VECTOR_TABLE}"`);
        await querier.run(
          `CREATE TABLE "${VECTOR_TABLE}" (id INT PRIMARY KEY, k INT, v VECTOR(3), w VECTOR(3), t STRING)`,
        );
        await querier.run(`CREATE VECTOR INDEX crdb_vec_cosine ON "${VECTOR_TABLE}" (k, v vector_cosine_ops)`);
        await querier.run(`CREATE VECTOR INDEX crdb_vec_default ON "${VECTOR_TABLE}" (w)`);
        await querier.run(`CREATE INDEX crdb_plain ON "${VECTOR_TABLE}" (t)`);
      });

      const schema = await new CockroachSchemaIntrospector(pool).getTableSchema(VECTOR_TABLE);

      expect(schema?.indexes?.map(({ name, type, distance, entries }) => ({ name, type, distance, entries }))).toEqual([
        {
          name: 'crdb_plain',
          type: undefined,
          distance: undefined,
          entries: [{ column: 't', order: 'asc' }],
        },
        {
          name: 'crdb_vec_cosine',
          type: 'vector',
          distance: 'cosine',
          entries: [
            { column: 'k', order: 'asc' },
            { column: 'v', order: 'asc' },
          ],
        },
        {
          name: 'crdb_vec_default',
          type: 'vector',
          distance: 'l2',
          entries: [{ column: 'w', order: 'asc' }],
        },
      ]);
    },
    provisioningTimeout,
  );
});
