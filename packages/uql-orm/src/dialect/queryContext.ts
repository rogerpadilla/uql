import type { QueryContext, QueryDialect } from '../type/index.js';

/**
 * SqlQueryContext is an implementation of the QueryContext interface specifically for SQL-based dialects.
 * It follows the "Accumulator" or "Builder" pattern to construct SQL queries and their corresponding parameters.
 *
 * This pattern solves the problem of building complex SQL strings while safely managing parameterized values,
 * preventing SQL injection and handling dialect-specific parameter placeholders (e.g., '?' for MySQL, '$n' for PostgreSQL).
 */
export class SqlQueryContext implements QueryContext {
  private readonly sqlChunks: string[] = [];
  private readonly params: unknown[] = [];

  /**
   * @param dialect The SQL dialect used to determine how values should be formatted as placeholders.
   */
  constructor(readonly dialect: QueryDialect) {}

  /**
   * Appends raw SQL string fragments to the query.
   *
   * @param sql The SQL fragment to append.
   * @returns The current context instance for method chaining.
   */
  append(sql: string): this {
    if (sql) {
      this.sqlChunks.push(sql);
    }
    return this;
  }

  /**
   * Adds a value to the query parameters and appends its corresponding placeholder to the SQL.
   * The placeholder format is determined by the dialect (e.g., '?' or '$1').
   *
   * @param value The value to be parameterized.
   * @returns The current context instance for method chaining.
   */
  addValue(value: unknown): this {
    this.sqlChunks.push(this.dialect.addValue(this.params, value));
    return this;
  }

  /**
   * Pushes a value to the parameters list without appending a placeholder to the SQL.
   * This is useful when the placeholder is already present in the SQL string or handled elsewhere.
   *
   * @param value The value to be added to the parameters.
   * @returns The current context instance for method chaining.
   */
  pushValue(value: unknown): this {
    this.params.push(value);
    return this;
  }

  /**
   * Returns the complete SQL query string by joining all accumulated chunks.
   */
  get sql() {
    return this.sqlChunks.join('');
  }

  /**
   * Returns the array of collected parameter values in the order they were added.
   */
  get values() {
    return this.params;
  }
}
