import { vi } from 'vitest';
import { AbstractSqlQuerierSpec } from '../querier/abstractSqlQuerier-spec.js';
import { createSpec } from '../test/index.js';

vi.mock('better-sqlite3', async () => {
  try {
    const { Database } = await import('bun:sqlite');
    class BetterSqlite3 extends Database {
      pragma(source: string) {
        return (this as any).query(`PRAGMA ${source}`).all();
      }
    }
    return {
      default: BetterSqlite3,
    };
  } catch (e) {
    return await vi.importActual('better-sqlite3');
  }
});

import { Sqlite3QuerierPool } from './sqliteQuerierPool.js';

class SqliteQuerierSpec extends AbstractSqlQuerierSpec {
  constructor() {
    super(new Sqlite3QuerierPool(':memory:'), 'INTEGER PRIMARY KEY');
  }

  override async beforeEach() {
    await super.beforeEach();
    await Promise.all([
      this.querier.run('PRAGMA foreign_keys = ON'),
      this.querier.run('PRAGMA journal_mode = WAL'),
      this.querier.run('PRAGMA synchronous = normal'),
      this.querier.run('PRAGMA temp_store = memory'),
    ]);
    vi.spyOn(this.querier, 'run').mockClear();
  }
}

createSpec(new SqliteQuerierSpec());
