import { createSpec } from 'nukak/test/index.js';
import { AbstractSqlDialectSpec } from 'nukak/dialect/abstractSqlDialect-spec.js';
import { MariaDialect } from './mariaDialect.js';

export class MariaDialectSpec extends AbstractSqlDialectSpec {
  constructor() {
    super(new MariaDialect());
  }
}

createSpec(new MariaDialectSpec());
