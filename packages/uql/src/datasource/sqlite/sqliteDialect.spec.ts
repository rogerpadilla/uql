import { createSpec } from 'uql/test.util';
import { SqlDialectSpec } from '../sqlDialectSpec';
import { SqliteDialect } from './sqliteDialect';

class SqliteDialectSpec extends SqlDialectSpec {
  constructor() {
    super(new SqliteDialect());
  }
}

createSpec(new SqliteDialectSpec());
