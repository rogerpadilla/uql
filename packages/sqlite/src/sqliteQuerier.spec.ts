import { AbstractSqlQuerierSpec } from '@uql/core/querier/abstractSqlQuerier-spec';
import { createSpec } from '@uql/core/test';
import { Sqlite3QuerierPool } from './sqlite3QuerierPool';

class SqliteQuerierSpec extends AbstractSqlQuerierSpec {
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
    jest.spyOn(this.querier, 'run').mockClear();
  }
}

createSpec(new SqliteQuerierSpec());
