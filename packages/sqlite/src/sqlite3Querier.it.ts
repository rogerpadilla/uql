import { createSpec } from '@uql/core/test';
import { AbstractSqlQuerierIt } from '@uql/core/querier/abstractSqlQuerier-it';
import { Sqlite3QuerierPool } from './sqlite3QuerierPool';

export class Sqlite3QuerierIt extends AbstractSqlQuerierIt {
  constructor() {
    super(new Sqlite3QuerierPool({ filename: ':memory:' }));
  }
}

createSpec(new Sqlite3QuerierIt());
