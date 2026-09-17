import { describe, expect, it } from 'vitest';
import { FLOATED_DECIMAL } from '../querier/abstractSqlQuerier-test.js';
import { VectorQuerierIt } from '../querier/vectorQuerier-test.js';
import { createSpec, probeForeignKeys } from '../test/index.js';
import { TursoLocalQuerierPool } from './tursoLocalQuerierPool.js';

// Unlike libsql, `:memory:` works here: the engine keeps a single connection, and transactions are
// plain `BEGIN`/`COMMIT` statements on it rather than a separate one, so no temp file is needed.
export class TursoLocalQuerierIt extends VectorQuerierIt {
  constructor() {
    super(new TursoLocalQuerierPool(':memory:'));
  }
  protected override expectedExactDecimal() {
    return FLOATED_DECIMAL;
  }

  // No `foreign_keys` pragma here: the pool sets it on connect, and a suite enabling it for itself is
  // why nobody noticed this driver defaults to off. See the enforcement test below.
}

createSpec(new TursoLocalQuerierIt());

describe('foreign key enforcement', () => {
  /** `@tursodatabase/database` defaults `foreign_keys` to off, so the pool's pragma is load-bearing here. */
  it('should enforce the constraints in its own DDL', async () => {
    const pool = new TursoLocalQuerierPool(':memory:');
    const querier = await pool.getQuerier();

    expect(await probeForeignKeys(querier)).toEqual({ dangling: 'rejected', orphans: [] });
    await pool.end();
  });
});
