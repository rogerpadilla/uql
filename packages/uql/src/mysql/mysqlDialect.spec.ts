import { expect } from 'bun:test';
import { AbstractSqlDialectSpec } from '../dialect/abstractSqlDialect-spec.js';
import { createSpec } from '../test/index.js';
import { MySqlDialect } from './mysqlDialect.js';

export class MySqlDialectSpec extends AbstractSqlDialectSpec {
  constructor() {
    super(new MySqlDialect());
  }

  shouldHandleDate() {
    const dialect = new MySqlDialect();
    const values: unknown[] = [];
    expect(dialect.addValue(values, new Date())).toBe('?');
    expect(values).toHaveLength(1);
    expect(values[0]).toBeInstanceOf(Date);
  }
}

createSpec(new MySqlDialectSpec());
