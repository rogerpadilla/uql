import { createSpec } from 'nukak/test';
import { AbstractSqlQuerierIt } from 'nukak/querier/abstractSqlQuerier-it.js';
import { Sqlite3QuerierPool } from './sqliteQuerierPool.js';

export class Sqlite3QuerierIt extends AbstractSqlQuerierIt {
  constructor() {
    super(new Sqlite3QuerierPool({ filename: ':memory:' }), 'INTEGER PRIMARY KEY');
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
