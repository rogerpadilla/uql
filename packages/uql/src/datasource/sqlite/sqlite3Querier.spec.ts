import { createSpec } from 'uql/test.util';
import { SqlQuerierSpec } from '../sqlQuerierSpec';
import Sqlite3QuerierPool from './sqlite3QuerierPool';

export class Sqlite3QuerierSpec extends SqlQuerierSpec {
  constructor() {
    super(new Sqlite3QuerierPool(':memory:'));
  }
}

createSpec(new Sqlite3QuerierSpec());
