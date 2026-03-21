import { AbstractSqlQuerierSpec } from '../querier/abstractSqlQuerier-spec.js';
import { createSpec } from '../test/index.js';
import { BunSqlQuerierPool } from './bunSqlQuerierPool.js';

class BunSqliteSpec extends AbstractSqlQuerierSpec {
  constructor() {
    super(new BunSqlQuerierPool('sqlite', ':memory:'), 'INTEGER PRIMARY KEY');
  }
}

createSpec(new BunSqliteSpec());
