import { createSpec } from '@uql/core/test';
import { AbstractSqlDialectSpec } from './abstractSqlDialect-spec';
import { MySqlDialect } from './mysqlDialect';

export class MySqlDialectSpec extends AbstractSqlDialectSpec {
  constructor() {
    super(new MySqlDialect());
  }
}

createSpec(new MySqlDialectSpec());
