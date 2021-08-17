import { createSpec } from '@uql/core/test';
import { AbstractSqlQuerierIt } from '@uql/core/querier/abstractSqlQuerier-it';
import { Sqlite3QuerierPool } from './sqlite3QuerierPool';

export class Sqlite3QuerierIt extends AbstractSqlQuerierIt {
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

createSpec(new Sqlite3QuerierIt());
