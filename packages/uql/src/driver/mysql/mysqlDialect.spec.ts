import { createSpec } from 'uql/test';
import { SqlDialectSpec } from '../sqlDialectSpec';
import { MySqlDialect } from './mysqlDialect';

export class MySqlDialectSpec extends SqlDialectSpec {
  constructor() {
    super(new MySqlDialect());
  }
}

createSpec(new MySqlDialectSpec());
