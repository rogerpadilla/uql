import { AbstractQuerierPoolIt } from '../querier/abstractQuerierPool-test.js';
import { createSpec } from '../test/index.js';
import type { SqliteQuerier } from './sqliteQuerier.js';
import { Sqlite3QuerierPool } from './sqliteQuerierPool.js';

export class Sqlite3QuerierPoolIt extends AbstractQuerierPoolIt<SqliteQuerier> {
  constructor() {
    super(new Sqlite3QuerierPool(':memory:'));
  }
}

createSpec(new Sqlite3QuerierPoolIt());
