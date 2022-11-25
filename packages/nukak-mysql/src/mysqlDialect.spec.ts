import { createSpec } from 'nukak/test/index.js';
import { AbstractSqlDialectSpec } from 'nukak/dialect/abstractSqlDialect-spec.js';
import { MySqlDialect } from './mysqlDialect.js';

export class MySqlDialectSpec extends AbstractSqlDialectSpec {
  constructor() {
    super(new MySqlDialect());
  }
}

createSpec(new MySqlDialectSpec());
