import { QueryRaw, SQL_VALUE_NAMES, type SqlValueName } from '../type/index.js';
import { isRecord } from '../util/object.util.js';
import { SQL_VALUES } from '../util/raw.js';

/**
 * The kind of a {@link SqlExpression}: a value uql exports by name, which `formatDefaultValue` spells for the
 * engine at DDL time, or `raw`, carrying its own SQL.
 */
export type SqlExpressionKind = SqlValueName | 'raw';

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

const NAME_OF: ReadonlyMap<unknown, SqlValueName> = new Map(SQL_VALUE_NAMES.map((name) => [SQL_VALUES[name], name]));

/**
 * A default in schema form: a value uql exports (`currentTimestamp`) becomes its kind, so each engine spells it
 * for the column it fills; other `raw` becomes the SQL `compile` renders, parenthesized; a literal is kept.
 */
export function schemaDefault(value: unknown, compile: (sql: QueryRaw) => string): unknown {
  const name = NAME_OF.get(value);
  if (name) {
    return new SqlExpression(name);
  }
  return value instanceof QueryRaw ? SqlExpression.parenthesized(compile(value)) : value;
}

/**
 * A default as text to compare: numbers as their digits, other text as written, and objects (SQL included) and text
 * holding a JSON object or list as JSON with its keys in order, equal as documents, since `jsonb` reprints them.
 */
export function writtenDefault(value: unknown): string {
  const document = typeof value === 'string' ? jsonDocument(value) : value;
  return typeof document === 'object' && document !== null ? JSON.stringify(document, keysInOrder) : String(value);
}

/** What `text` spells as JSON, or nothing where it is no JSON at all. */
function jsonDocument(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A `JSON.stringify` replacer writing each object's keys in order. */
function keysInOrder(_key: string, value: unknown): unknown {
  return isRecord(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))) : value;
}
