/**
 * Runs one statement of the cursor protocol on the querier's own connection, which holds the cursor, and
 * not through `all()`, whose `serialize` is not re-entrant.
 */
type CursorExecutor<T> = (query: string, values?: unknown[]) => Promise<T[]>;

/** The cursor a stream declares. Suffixed per call, so two streams on one connection cannot collide. */
const CURSOR_ALIAS = '_uql_cursor';

/** Rows per round trip, matching `pg-query-stream`'s own default so both paths read the same. */
const FETCH_SIZE = 100;

let cursorSeq = 0;

/**
 * Streams a Postgres-wire read through a server-side cursor. `DECLARE` needs a transaction, so one is
 * opened on the connection itself when the caller has none, leaving the querier's state untouched.
 * Cleanup sits in `finally`, which a consumer that stops early still reaches, and is best-effort once
 * the read failed, so the read's error stays the one thrown.
 */
export async function* streamViaCursor<T>(
  exec: CursorExecutor<T>,
  query: string,
  values?: unknown[],
  inTransaction = false,
): AsyncIterable<T> {
  const cursor = `${CURSOR_ALIAS}_${++cursorSeq}`;
  const ownsTransaction = !inTransaction;
  if (ownsTransaction) {
    await exec('BEGIN');
  }
  let failed = false;
  try {
    await exec(`DECLARE ${cursor} CURSOR FOR ${query}`, values);
    for (;;) {
      const rows = await exec(`FETCH FORWARD ${FETCH_SIZE} FROM ${cursor}`);
      yield* rows;
      if (rows.length < FETCH_SIZE) {
        return;
      }
    }
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    const end = failed ? (sql: string) => exec(sql).catch(() => []) : exec;
    await end(`CLOSE ${cursor}`);
    if (ownsTransaction) {
      await end(failed ? 'ROLLBACK' : 'COMMIT');
    }
  }
}
