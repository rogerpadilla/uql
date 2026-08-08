import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VectorQuerierIt } from '../querier/vectorQuerier-test.js';
import { createSpec, probeForeignKeys } from '../test/index.js';
import { LibsqlQuerierPool } from './libsqlQuerierPool.js';

// `:memory:` is avoided here: `client.transaction()` opens a separate connection, and SQLite's
// in-memory databases are private per-connection without shared-cache mode, so that connection
// sees a blank schema. A real file is shared across connections like any other database file.
const dbFile = join(tmpdir(), `uql-libsql-${randomUUID()}.db`);

export class LibsqlQuerierIt extends VectorQuerierIt {
  constructor() {
    super(new LibsqlQuerierPool({ url: `file:${dbFile}` }));
  }
  /**
   * SQLite has no DECIMAL type. NUMERIC affinity converts the literal to a float on write, so the
   * exact digits are lost in the database, not on the way back out.
   */
  protected override expectedExactDecimal(): number {
    return 12345678901234567000;
  }

  // No `foreign_keys` pragma here: libSQL turns enforcement on itself, unlike vanilla SQLite. The test
  // below is what holds that default in place.

  override async afterAll() {
    await super.afterAll();
    rmSync(dbFile, { force: true });
    rmSync(`${dbFile}-wal`, { force: true });
    rmSync(`${dbFile}-shm`, { force: true });
  }
}

createSpec(new LibsqlQuerierIt());

describe('foreign key enforcement', () => {
  it('should enforce without the pool setting a pragma, which libSQL does itself', async () => {
    const file = join(tmpdir(), `uql-libsql-fk-${randomUUID()}.db`);
    const pool = new LibsqlQuerierPool({ url: `file:${file}` });
    const querier = await pool.getQuerier();

    expect(await probeForeignKeys(querier)).toEqual({ dangling: 'rejected', orphans: [] });
    await pool.end();
    rmSync(file, { force: true });
  });
});
