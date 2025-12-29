import { AbstractQuerierPoolIt } from 'nukak/querier/abstractQuerierPool-it.js';
import { createSpec } from 'nukak/test';
import type { SqliteQuerier } from './sqliteQuerier.js';
import { Sqlite3QuerierPool } from './sqliteQuerierPool.js';

export class Sqlite3QuerierPoolIt extends AbstractQuerierPoolIt<SqliteQuerier> {
  constructor() {
    super(new Sqlite3QuerierPool(':memory:'));
  }
}

createSpec(new Sqlite3QuerierPoolIt());
