import { createSpec } from 'uql/test/test.util';
import { SqlDialectSpec } from 'uql/querier/sqlDialectSpec';
import { MySqlDialect } from './mysqlDialect';

export class MySqlDialectSpec extends SqlDialectSpec {
  constructor() {
    super(new MySqlDialect());
  }
}

createSpec(new MySqlDialectSpec());
