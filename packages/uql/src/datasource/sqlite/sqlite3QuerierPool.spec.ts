import { createSpec } from 'uql/test.util';
import { SqlQuerierPoolSpec } from '../sqlQuerierPoolSpec';
import Sqlite3QuerierPool from './sqlite3QuerierPool';

export class Sqlite3QuerierPoolSpec extends SqlQuerierPoolSpec {
  constructor() {
    super(new Sqlite3QuerierPool(':memory:'));
  }
}

createSpec(new Sqlite3QuerierPoolSpec());
