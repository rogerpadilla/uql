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
