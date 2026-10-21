import type { RawRow } from '../type/index.js';
import type { SqlExecution } from '../util/sql.util.js';

/** A node-postgres result as the querier reads it: its rows, and the rows it changed. */
export type PgResult = { readonly rows: RawRow[]; readonly rowCount: number | null };

export function pgExecution({ rows, rowCount }: PgResult): SqlExecution {
  return { rows, changes: rowCount };
}
