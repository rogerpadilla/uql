import { createSpec } from '@uql/core/test';
import { BaseSqlDialectSpec } from '@uql/core/sql/baseSqlDialect-spec';
import { MySqlDialect } from './mysqlDialect';

export class MySqlDialectSpec extends BaseSqlDialectSpec {
  constructor() {
    super(new MySqlDialect());
  }
}

createSpec(new MySqlDialectSpec());
