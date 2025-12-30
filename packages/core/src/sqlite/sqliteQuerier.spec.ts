import { jest, mock } from 'bun:test';
import { AbstractSqlQuerierSpec } from '../querier/abstractSqlQuerier-spec.js';
import { createSpec } from '../test/index.js';

mock.module('better-sqlite3', () => {
  const { Database } = require('bun:sqlite');
  class BetterSqlite3 extends Database {
    pragma(source: string) {
      return this.query(`PRAGMA ${source}`).all();
    }
  }
  return {
    default: BetterSqlite3,
  };
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
    jest.spyOn(this.querier, 'run').mockClear();
  }
}

createSpec(new SqliteQuerierSpec());
