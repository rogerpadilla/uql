import { AbstractSqlQuerierIt } from '../querier/abstractSqlQuerier-test.js';
import { createSpec, type LedgerAccount } from '../test/index.js';
import type { IdValue } from '../type/index.js';
import { Sqlite3QuerierPool } from './sqliteQuerierPool.js';

export class Sqlite3QuerierIt extends AbstractSqlQuerierIt {
  constructor() {
    super(new Sqlite3QuerierPool(':memory:'), 'INTEGER PRIMARY KEY');
  }

  /** SQLite reports header-derived IDs only, which are unsafe for mixed batches. */
  protected override expectedMixedBatchIds([, providedId]: IdValue<LedgerAccount>[]): IdValue<LedgerAccount>[] {
    return [undefined, providedId, undefined];
  }

  override async beforeEach() {
    await super.beforeEach();
    await Promise.all([
      this.querier.run('PRAGMA foreign_keys = ON'),
      this.querier.run('PRAGMA journal_mode = WAL'),
      this.querier.run('PRAGMA synchronous = normal'),
      this.querier.run('PRAGMA temp_store = memory'),
    ]);
  }
}

createSpec(new Sqlite3QuerierIt());
