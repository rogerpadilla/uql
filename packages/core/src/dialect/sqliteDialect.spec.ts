import { createSpec } from '../test/index.js';
import { AbstractSqlDialectSpec } from './abstractSqlDialect-spec.js';
import { SqliteDialect } from './sqliteDialect.js';

class SqliteDialectSpec extends AbstractSqlDialectSpec {
  constructor() {
    super(new SqliteDialect());
  }
}

createSpec(new SqliteDialectSpec());
