import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, describe, expect, it, onTestFinished } from 'vitest';
import { SqliteLikeQuerierIt } from '../querier/sqliteLikeQuerier-test.js';
import { createSpec, MeasureUnitCategory, probeForeignKeys } from '../test/index.js';
import { LibsqlQuerierPool } from './libsqlQuerierPool.js';

/** A database file gone, with the journal files beside it. */
function removeDb(file: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${file}${suffix}`, { force: true });
  }
}

// A file rather than `:memory:`: `client.transaction()` opens a connection of its own, and an in-memory
// database is private to the connection that made it.
const dbFile = join(tmpdir(), `uql-libsql-${uuidv7()}.db`);
afterAll(() => removeDb(dbFile));

/** Embedded libSQL matches with SQLite's own `REGEXP`, which takes no inline flag, and its client registers no other. */
class EmbeddedLibsqlQuerierIt extends SqliteLikeQuerierIt {
  override async shouldMatchARegexCaseInsensitivelyByALeadingFlag() {
    await this.querier.insertOne(MeasureUnitCategory, { name: 'Alpha' });
    await expect(this.categoryNames({ name: { $regex: '(?i)^A' } })).rejects.toThrow("'?' without operand");
  }
}

createSpec(new EmbeddedLibsqlQuerierIt(new LibsqlQuerierPool({ url: `file:${dbFile}` })));

describe('foreign key enforcement', () => {
  it('should enforce without the pool setting a pragma, which libSQL does itself', async () => {
    const file = join(tmpdir(), `uql-libsql-fk-${uuidv7()}.db`);
    const pool = new LibsqlQuerierPool({ url: `file:${file}` });
    onTestFinished(async () => {
      await pool.end();
      removeDb(file);
    });
    const querier = await pool.getQuerier();

    expect(await probeForeignKeys(querier)).toEqual({ dangling: 'rejected', orphans: [] });
  });
});
