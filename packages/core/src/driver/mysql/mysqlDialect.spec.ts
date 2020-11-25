import { createSpec } from '../../test';
import { BaseSqlDialectSpec } from '../baseSqlDialectSpec';
import { MySqlDialect } from './mysqlDialect';

export class MySqlDialectSpec extends BaseSqlDialectSpec {
  constructor() {
    super(new MySqlDialect());
  }
}

createSpec(new MySqlDialectSpec());
