import { expect } from 'vitest';
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

  shouldEscape() {
    const dialect = new MySqlDialect();
    expect(dialect.escape("va'lue")).toBe("'va\\'lue'");
  }

  shouldHandleOtherValues() {
    const dialect = new MySqlDialect();
    const values: unknown[] = [];
    expect(dialect.addValue(values, 123)).toBe('?');
    expect(values[0]).toBe(123);
  }
}

createSpec(new MySqlDialectSpec());
