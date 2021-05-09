import { createSpec } from '../../test';
import { BaseSqlQuerierPoolIt } from '../baseSqlQuerierPoolIt';
import { Sqlite3QuerierPool } from './sqlite3QuerierPool';

export class Sqlite3QuerierPoolIt extends BaseSqlQuerierPoolIt {
  readonly primaryKeyType = 'INTEGER PRIMARY KEY AUTOINCREMENT';

  constructor() {
    super(new Sqlite3QuerierPool({ filename: ':memory:' }));
  }
}

createSpec(new Sqlite3QuerierPoolIt());
