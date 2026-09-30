/**
 * The kind of a {@link SqlExpression}. Kinds are symbolic: `formatDefaultValue` renders each in the
 * dialect's spelling at DDL time, while `raw` carries its own SQL.
 */
export type SqlExpressionKind = 'now' | 'currentDate' | 'currentTime' | 'uuid' | 'uuidv7' | 'onUpdateNow' | 'raw';

/**
 * A column default that is SQL rather than a literal, whether an entity or a migration declares it or
 * introspection reads it back. It is a class, not a plain object, so a JSON default cannot pass for one.
 */
export class SqlExpression {
  /** `sql` is set only for the `raw` kind, which carries its own text verbatim. */
  constructor(
    readonly kind: SqlExpressionKind,
    readonly sql?: string,
  ) {}

  static isExpression(value: unknown): value is SqlExpression {
    return value instanceof SqlExpression;
  }

  /** Wraps `sql` in parentheses, which every engine accepts for a default expression and SQLite and MySQL require. */
  static parenthesized(sql: string): SqlExpression {
    return new SqlExpression('raw', `(${sql})`);
  }

  /** Its SQL, or its kind, as diffs and drift reports show it. */
  toString(): string {
    return this.sql ?? this.kind;
  }
}

/** A default as text for an exact comparison: objects (SQL included) as JSON, numbers as their digits. */
export function writtenDefault(value: unknown): string {
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
