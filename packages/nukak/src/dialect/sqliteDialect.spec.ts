import { createSpec } from '../test';
import { AbstractSqlDialectSpec } from './abstractSqlDialect-spec.js';
import { SqliteDialect } from './sqliteDialect.js';

class SqliteDialectSpec extends AbstractSqlDialectSpec {
  constructor() {
    super(new SqliteDialect());
  }
}

createSpec(new SqliteDialectSpec());
