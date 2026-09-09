import { describe, expect, it } from 'vitest';
import { AbstractSqlQuerierIt, FLOATED_DECIMAL } from '../querier/abstractSqlQuerier-test.js';
import { AbstractSqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { createSpec, probeForeignKeys } from '../test/index.js';
import type { BunSqlQuerier } from './bunSqlQuerier.js';
import { BunSqlQuerierPool } from './bunSqlQuerierPool.js';

const url = 'sqlite://:memory:';

/**
 * Stops short of the vector suite, which every other SQLite driver here runs: those tests need
 * `sqlite-vec` loaded, and `bun:sql`'s SQLite options expose no way to load an extension, unlike
 * `bun:sqlite`'s own `Database` (see `sqlite/sqliteQuerierPool.ts`).
 */
class BunSqliteIt extends AbstractSqlQuerierIt {
  constructor() {
    super(new BunSqlQuerierPool({ url }));
  }

  protected override expectedExactDecimal() {
    return FLOATED_DECIMAL;
  }
}

class BunSqlitePoolIt extends AbstractSqlQuerierPoolIt<BunSqlQuerier> {
  constructor() {
    super(new BunSqlQuerierPool({ url }));
  }
}

createSpec(new BunSqliteIt());
createSpec(new BunSqlitePoolIt());

describe('foreign key enforcement', () => {
  /** `bun:sql`'s SQLite adapter defaults `foreign_keys` to off, so the pool's pragma is load-bearing here. */
  it('should enforce the constraints in its own DDL', async () => {
    const pool = new BunSqlQuerierPool({ url });
    const querier = await pool.getQuerier();

    expect(await probeForeignKeys(querier)).toEqual({ dangling: 'rejected', orphans: [] });
    await pool.end();
  });
});
