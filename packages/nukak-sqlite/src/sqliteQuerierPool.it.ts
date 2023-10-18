import { createSpec } from 'nukak/test';
import { AbstractQuerierPoolIt } from 'nukak/querier/abstractQuerierPool-it.js';
import { Sqlite3QuerierPool } from './sqliteQuerierPool.js';
import { SqliteQuerier } from './sqliteQuerier.js';

export class Sqlite3QuerierPoolIt extends AbstractQuerierPoolIt<SqliteQuerier> {
  constructor() {
    super(new Sqlite3QuerierPool({ filename: ':memory:' }));
  }
}

createSpec(new Sqlite3QuerierPoolIt());
