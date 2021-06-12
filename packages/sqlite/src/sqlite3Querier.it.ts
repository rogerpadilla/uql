import { createSpec } from '@uql/core/test';
import { BaseSqlQuerierIt } from '@uql/core/sql/baseSqlQuerier-it';
import { Sqlite3QuerierPool } from './sqlite3QuerierPool';

export class Sqlite3QuerierIt extends BaseSqlQuerierIt {
  constructor() {
    super(new Sqlite3QuerierPool({ filename: ':memory:' }));
  }
}

createSpec(new Sqlite3QuerierIt());
