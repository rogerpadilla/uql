import { createSpec } from '../test/index';
import { AbstractSqlDialectSpec } from './abstractSqlDialect-spec';
import { SqliteDialect } from './sqliteDialect';

class SqliteDialectSpec extends AbstractSqlDialectSpec {
  constructor() {
    super(new SqliteDialect());
  }
}

createSpec(new SqliteDialectSpec());
