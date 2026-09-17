import type { QueryContext, SqlQueryDialect } from '../type/index.js';

/** A SQL statement being built: its text, and the values it binds, placeholders numbered by the dialect. */
export class SqlQueryContext implements QueryContext {
  private readonly sqlChunks: string[] = [];
  private readonly params: unknown[];
  private readonly tableAliases = new Set<string>();

  /**
   * `params` and `statement` are a fragment's parent's, so a value numbers against the whole statement and
   * an alias is unique across it; a fragment inlines values where its statement does.
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

  /** Binds values whose placeholders the SQL already carries. */
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
