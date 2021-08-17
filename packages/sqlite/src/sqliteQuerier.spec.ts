import { AbstractSqlQuerierSpec } from '@uql/core/querier/abstractSqlQuerier-spec';
import { createSpec } from '@uql/core/test';
import { Sqlite3QuerierPool } from './sqlite3QuerierPool';

class SqliteQuerierSpec extends AbstractSqlQuerierSpec {
  readonly idType = 'INTEGER PRIMARY KEY';

  constructor() {
    super(new Sqlite3QuerierPool({ filename: ':memory:' }));
  }

  async beforeAll() {
    await super.beforeAll();
    this.querier = await this.pool.getQuerier();
    await this.querier.run('PRAGMA foreign_keys = ON');
    await this.querier.release();
  }
}

createSpec(new SqliteQuerierSpec());
