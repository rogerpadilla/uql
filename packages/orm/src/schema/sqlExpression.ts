import { QuerySql, SQL_VALUE_NAMES, type SqlValueName } from '../type/index.js';
import { byCodeUnit, isJsonScalar, isRecord, jsonDocument } from '../util/object.util.js';
import { SQL_VALUES } from '../util/sql.js';
import { UqlUsageError } from '../util/uqlError.js';
import type { ColumnDefault } from './types.js';

const EXPRESSION: unique symbol = Symbol('sqlExpression');

/**
 * A column default that is SQL rather than a literal: a value uql exports by name, which each engine spells for the
 * column it fills, or raw SQL carrying its own text. Built by `SqlExpression`, branded by a symbol JSON cannot carry.
 */
export type SqlExpression = { readonly [EXPRESSION]: true } & (
  | { readonly kind: SqlValueName; readonly sql?: undefined }
  | { readonly kind: 'sql'; readonly sql: string }
);

export const SqlExpression = {
  named: (kind: SqlValueName): SqlExpression => ({ [EXPRESSION]: true, kind }),
  raw: (sql: string): SqlExpression => ({ [EXPRESSION]: true, kind: 'sql', sql }),
  /** Wraps `sql` in parentheses, which every engine accepts for a default expression and SQLite and MySQL require. */
  parenthesized: (sql: string): SqlExpression => SqlExpression.raw(`(${sql})`),
  isExpression: (value: unknown): value is SqlExpression =>
    typeof value === 'object' && value !== null && EXPRESSION in value,
};

/** Its SQL, or its kind, as diffs and drift reports show it. */
export function sqlExpressionText(expression: SqlExpression): string {
  return expression.sql ?? expression.kind;
}

const NAME_OF: ReadonlyMap<unknown, SqlValueName> = new Map(SQL_VALUE_NAMES.map((name) => [SQL_VALUES[name], name]));

/**
 * A default in schema form: a value uql exports (`currentTimestamp`) becomes its kind, so each engine spells it
 * for the column it fills; other `raw` the SQL `compile` renders, parenthesized; a document, or any value of a
 * `json` column, its JSON text, which is how the database reports it back; another literal is kept.
 */
export function schemaDefault(
  value: unknown,
  compile: (sql: QuerySql) => string,
  json = false,
): ColumnDefault | undefined {
  const name = NAME_OF.get(value);
  if (name) {
    return SqlExpression.named(name);
  }
  if (value instanceof QuerySql) {
    return SqlExpression.parenthesized(compile(value));
  }
  if (value === undefined || value === null || SqlExpression.isExpression(value)) {
    return value;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new UqlUsageError(`a default cannot be ${value}: no SQL literal holds it`);
  }
  return !json && (isJsonScalar(value) || typeof value === 'bigint' || value instanceof Date)
    ? value
    : JSON.stringify(value);
}

/**
 * A default as text to compare: numbers as their digits, other text as written, and SQL and text holding a JSON
 * object or list as JSON with its keys in order, equal as documents, since `jsonb` reprints them.
 */
export function writtenDefault(value: ColumnDefault): string {
  const document = typeof value === 'string' ? jsonDocument(value) : value;
  return typeof document === 'object' && document !== null ? JSON.stringify(document, keysInOrder) : String(value);
}

/** A `JSON.stringify` replacer writing each object's keys in order. */
function keysInOrder(_key: string, value: unknown): unknown {
  return isRecord(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => byCodeUnit(a, b))) : value;
}
