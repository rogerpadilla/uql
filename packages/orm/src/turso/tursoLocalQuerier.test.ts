import { describe, expect, it, onTestFinished } from 'vitest';
import { SqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { SqliteLikeQuerierIt } from '../querier/sqliteLikeQuerier-test.js';
import { createSpec, probeForeignKeys } from '../test/index.js';
import { TursoLocalQuerierPool } from './tursoLocalQuerierPool.js';

// `:memory:` works here, unlike on libSQL: the engine keeps one connection, and a transaction is a `BEGIN` on it.
createSpec(new SqliteLikeQuerierIt(new TursoLocalQuerierPool(':memory:')));
createSpec(new SqlQuerierPoolIt(() => new TursoLocalQuerierPool(':memory:')));

describe('foreign key enforcement', () => {
  /** `@tursodatabase/database` defaults `foreign_keys` to off, so the pool's pragma is load-bearing here. */
  it('should enforce the constraints in its own DDL', async () => {
    const pool = new TursoLocalQuerierPool(':memory:');
    onTestFinished(() => pool.end());
    const querier = await pool.getQuerier();

    expect(await probeForeignKeys(querier)).toEqual({ dangling: 'rejected', orphans: [] });
  });
});
