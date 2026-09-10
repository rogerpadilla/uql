import type { SqlitePreparedStatement } from './abstractSqliteQuerier.js';

/**
 * How every local SQLite connection opens. WAL, so a reader does not wait on the writer, and
 * `foreign_keys`, which SQLite ships off per connection for backward compatibility: without it the
 * constraints uql's own DDL declares are decorative - a declared `onDelete: 'CASCADE'` silently does
 * nothing and a dangling reference is accepted.
 */
export const SQLITE_PRAGMAS = ['journal_mode = WAL', 'foreign_keys = ON'] as const;

/** Runs {@link SQLITE_PRAGMAS} through a driver's own statements, whether it answers now or later. */
export async function applySqlitePragmas(db: {
  prepare(sql: string): SqlitePreparedStatement | Promise<SqlitePreparedStatement>;
}): Promise<void> {
  for (const pragma of SQLITE_PRAGMAS) {
    const stmt = await db.prepare(`PRAGMA ${pragma}`);
    // `journal_mode` answers with a row and `foreign_keys` with none; `reader` picks the call for each.
    await (stmt.reader ? stmt.all() : stmt.run());
  }
}
