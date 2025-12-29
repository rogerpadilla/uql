import { AbstractSqlDialectSpec } from '../dialect/abstractSqlDialect-spec.js';
import { createSpec } from '../test/index.js';
import { MySqlDialect } from './mysqlDialect.js';

export class MySqlDialectSpec extends AbstractSqlDialectSpec {
  constructor() {
    super(new MySqlDialect());
  }
}

createSpec(new MySqlDialectSpec());
