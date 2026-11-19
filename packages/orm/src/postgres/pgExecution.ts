import type { RawRow } from '../type/index.js';
import type { SqlExecution } from '../util/sql.util.js';

/** A Postgres-wire result as the querier reads it: its rows, and its command tag, named and counted. */
export type PgResult = { readonly rows: RawRow[]; readonly rowCount?: number | null; readonly command?: string | null };

export function pgExecution({ rows, rowCount, command }: PgResult): SqlExecution {
  return { rows, changes: rowCount, command };
}
