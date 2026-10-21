import type { BoundStatement } from '../querier/index.js';

/** What every SQLite driver binds. No `boolean`, which the drivers refuse and the dialect writes as an integer. */
export type SqliteBindValue = null | string | number | bigint | Uint8Array;

/** The compiler hands values over untyped, which the dialect has already normalized to what SQLite binds. */
export function toBindValues(values: readonly unknown[] = []): SqliteBindValue[] {
  return values as SqliteBindValue[];
}

/** `statements` as a SQLite driver taking a list names each one: its SQL and the values it binds. */
export function sqliteStatements(statements: readonly BoundStatement[]): { sql: string; args: SqliteBindValue[] }[] {
  return statements.map(({ sql, values }) => ({ sql, args: toBindValues(values) }));
}
