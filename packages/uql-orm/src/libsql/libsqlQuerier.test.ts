import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VectorQuerierIt } from '../querier/vectorQuerier-test.js';
import { createSpec } from '../test/index.js';
import { LibsqlQuerierPool } from './libsqlQuerierPool.js';

// `:memory:` is avoided here: `client.transaction()` opens a separate connection, and SQLite's
// in-memory databases are private per-connection without shared-cache mode, so that connection
// sees a blank schema. A real file is shared across connections like any other database file.
const dbFile = join(tmpdir(), `uql-libsql-${randomUUID()}.db`);

export class LibsqlQuerierIt extends VectorQuerierIt {
  constructor() {
    super(new LibsqlQuerierPool({ url: `file:${dbFile}` }));
  }

  override async beforeEach() {
    await super.beforeEach();
    await this.querier.run('PRAGMA foreign_keys = ON');
  }

  override async afterAll() {
    await super.afterAll();
    rmSync(dbFile, { force: true });
    rmSync(`${dbFile}-wal`, { force: true });
    rmSync(`${dbFile}-shm`, { force: true });
  }
}

createSpec(new LibsqlQuerierIt());
