/**
 * SQL Expressions
 *
 * Type-safe SQL expressions for default values and other uses.
 * Provides a `t` helper with common expressions.
 */

/**
 * Represents a raw SQL expression (not a literal value).
 */
export class SqlExpression {
  constructor(readonly sql: string) {}

  toString(): string {
    return this.sql;
  }

  /**
   * Check if a value is a SQL expression.
   */
  static isExpression(value: unknown): value is SqlExpression {
    return value instanceof SqlExpression;
  }
}

/**
 * Helper object for common SQL expressions.
 * Use in migrations: `table.timestamp('createdAt').defaultValue(t.now())`
 */
export const t = {
  /**
   * Current timestamp (NOW() or CURRENT_TIMESTAMP depending on dialect).
   */
  now(): SqlExpression {
    return new SqlExpression('CURRENT_TIMESTAMP');
  },

  /**
   * Current date (CURRENT_DATE).
   */
  currentDate(): SqlExpression {
    return new SqlExpression('CURRENT_DATE');
  },

  /**
   * Current time (CURRENT_TIME).
   */
  currentTime(): SqlExpression {
    return new SqlExpression('CURRENT_TIME');
  },

  /**
   * NULL value.
   */
  null(): SqlExpression {
    return new SqlExpression('NULL');
  },

  /**
   * Boolean true.
   */
  true(): SqlExpression {
    return new SqlExpression('TRUE');
  },

  /**
   * Boolean false.
   */
  false(): SqlExpression {
    return new SqlExpression('FALSE');
  },

  /**
   * Generate UUID (Postgres: gen_random_uuid(), MySQL: UUID()).
   */
  uuid(): SqlExpression {
    return new SqlExpression('gen_random_uuid()');
  },

  /**
   * Auto-generate UUID for MySQL.
   */
  mysqlUuid(): SqlExpression {
    return new SqlExpression('UUID()');
  },

  /**
   * Raw SQL expression.
   * Use for custom expressions not covered by helpers.
   */
  raw(sql: string): SqlExpression {
    return new SqlExpression(sql);
  },

  /**
   * String literal with proper escaping.
   */
  literal(value: string): SqlExpression {
    // Escape single quotes by doubling them
    const escaped = value.replace(/'/g, "''");
    return new SqlExpression(`'${escaped}'`);
  },

  /**
   * Numeric literal.
   */
  number(value: number): SqlExpression {
    return new SqlExpression(String(value));
  },

  /**
   * Empty JSON object.
   */
  emptyObject(): SqlExpression {
    return new SqlExpression("'{}'::jsonb");
  },

  /**
   * Empty JSON array.
   */
  emptyArray(): SqlExpression {
    return new SqlExpression("'[]'::jsonb");
  },

  /**
   * MySQL: ON UPDATE CURRENT_TIMESTAMP.
   */
  onUpdateNow(): SqlExpression {
    return new SqlExpression('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  },
};

/**
 * Format a default value for SQL.
 * Handles SqlExpression vs literal values.
 */
export function formatDefaultValue(value: unknown): string {
  if (value === undefined || value === null) {
    return 'NULL';
  }

  if (SqlExpression.isExpression(value)) {
    return value.sql;
  }

  if (typeof value === 'string') {
    // Escape single quotes for string literals
    const escaped = value.replace(/'/g, "''");
    return `'${escaped}'`;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }

  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }

  if (typeof value === 'object') {
    // JSON value
    const json = JSON.stringify(value).replace(/'/g, "''");
    return `'${json}'`;
  }

  return String(value);
}
