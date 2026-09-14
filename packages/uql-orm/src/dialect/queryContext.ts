import type { QueryContext, SqlQueryDialect } from '../type/index.js';

/**
 * SqlQueryContext is an implementation of the QueryContext interface specifically for SQL-based dialects.
 * It follows the "Accumulator" or "Builder" pattern to construct SQL queries and their corresponding parameters.
 *
 * This pattern solves the problem of building complex SQL strings while safely managing parameterized values,
 * preventing SQL injection and handling dialect-specific parameter placeholders (e.g., '?' for MySQL, '$n' for PostgreSQL).
 */
export class SqlQueryContext implements QueryContext {
  private readonly sqlChunks: string[] = [];
  private readonly params: unknown[];
  private readonly tableAliases = new Set<string>();

  /**
   * @param dialect The SQL dialect used to determine how values should be formatted as placeholders.
   * @param params An existing values array to bind into instead of a fresh one - shared by a
   * fragment context built via {@link AbstractSqlDialect.buildFragment}, so a bound value's
   * placeholder is numbered correctly against the real query from the moment it's added, rather
   * than needing to be reconciled after the fact.
   * @param statement The context this one renders a fragment of, which owns the claimed aliases: a
   * fragment is part of one statement, so its aliases have to be unique across the whole of it.
   * @param inlineValues See {@link QueryContext.inlineValues}; a fragment takes its statement's.
   */
  constructor(
    readonly dialect: SqlQueryDialect,
    params: unknown[] = [],
    private readonly statement?: SqlQueryContext,
    readonly inlineValues = false,
  ) {
    this.params = params;
  }

  createFragment(): QueryContext {
    return new SqlQueryContext(this.dialect, this.params, this.statement ?? this, this.inlineValues);
  }

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
   * Appends the SQL the dialect writes for `value`: a placeholder for the value bound, or its literal
   * where this context inlines values.
   */
  addValue(value: unknown): this {
    this.sqlChunks.push(this.dialect.addValue(this, value));
    return this;
  }

  /**
   * Pushes values to the parameters list without appending placeholders to the SQL.
   * This is useful when the placeholder is already present in the SQL string or handled elsewhere.
   *
   * @param values The values to be added to the parameters.
   * @returns The current context instance for method chaining.
   */
  pushValue(...values: unknown[]): this {
    this.params.push(...values.map((v) => this.dialect.normalizeValue(v)));
    return this;
  }

  claimAlias(name: string, parent?: string): string {
    if (this.statement) {
      return this.statement.claimAlias(name, parent);
    }
    const reserved = parent?.toLowerCase();
    let alias = name;
    for (let n = 2; this.tableAliases.has(alias.toLowerCase()) || alias.toLowerCase() === reserved; n++) {
      alias = `${name}_${n}`;
    }
    this.tableAliases.add(alias.toLowerCase());
    return alias;
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
