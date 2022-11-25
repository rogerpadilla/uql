import { createSpec, Item, User } from '../test/index.js';
import { AbstractSqlDialectSpec } from './abstractSqlDialect-spec.js';
import { MySqlDialect } from './mysqlDialect.js';

export class MySqlDialectSpec extends AbstractSqlDialectSpec {
  constructor() {
    super(new MySqlDialect());
  }
}

createSpec(new MySqlDialectSpec());
