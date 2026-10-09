import { afterAll, describe, expect, it } from 'vitest';
import { MariadbSchemaIntrospector } from '../migrate/introspection/mysqlIntrospector.js';
import { assertDefined, mariadbConnection, provisioningTimeout } from '../test/index.js';
import { dropTables } from '../test/sqlPools.js';
import { raw } from '../util/raw.js';
import { MariadbQuerierPool } from './mariadbQuerierPool.js';

const TABLE = 'maria_vector_index';

/** MariaDB keeps a vector index's distance only in the table's definition, and leaves its own default, euclidean, out. */
describe('MariaDB vector index', () => {
  const pool = new MariadbQuerierPool(mariadbConnection());

  afterAll(async () => {
    await dropTables(pool, TABLE);
    await pool.end();
  }, provisioningTimeout);

  it('should read a vector index built without a distance as euclidean, beside a plain index', async () => {
    await dropTables(pool, TABLE);
    await pool.run(
      raw.text(
        `CREATE TABLE ${TABLE} (id INT PRIMARY KEY, n INT, vec VECTOR(3) NOT NULL, VECTOR INDEX ix_maria_vec (vec), INDEX ix_maria_n (n))`,
      ),
    );

    const schema = await new MariadbSchemaIntrospector(pool).getTableSchema(TABLE);

    assertDefined(schema);
    assertDefined(schema.indexes);
    expect(schema.indexes.map(({ name, type, distance }) => ({ name, type, distance }))).toEqual([
      { name: 'ix_maria_n', type: undefined, distance: undefined },
      { name: 'ix_maria_vec', type: 'vector', distance: 'l2' },
    ]);
  });
});
