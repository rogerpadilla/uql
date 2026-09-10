/**
 * Runs one statement of the cursor protocol. `internalAll` for every caller so far: the cursor holds
 * a connection's session state, so it must be the querier's own connection, and it must not go
 * through `all()`, whose `serialize` is not re-entrant.
 */
export type CursorExecutor<T> = (query: string, values?: unknown[]) => Promise<T[]>;

/** The cursor a stream declares. Suffixed per call, so two streams on one connection cannot collide. */
const CURSOR_ALIAS = '_uql_cursor';

/** Rows per round trip, matching `pg-query-stream`'s own default so both paths read the same. */
const FETCH_SIZE = 100;

let cursorSeq = 0;

/**
 * Stream a Postgres-wire result through a server-side cursor, for a driver whose client exposes none:
 * `bun:sql` (no cursor API at all, [oven-sh/bun#17181](https://github.com/oven-sh/bun/issues/17181))
 * and PGlite. `pg` has `pg-query-stream` and keeps using it.
 *
 * `DECLARE` is only legal inside a transaction, so one is opened here when the caller has none - and
 * then committed, or rolled back if the stream failed. That `BEGIN` goes straight to the connection
 * rather than through `beginTransaction`, so the querier's own transaction state stays untouched:
 * this one is the generator's, and ends with it.
 *
 * The cleanup lives in `finally` because a consumer that stops early (`break`, a `throw` downstream)
 * ends the generator there and nowhere else, and an abandoned cursor holds its transaction open.
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
    // Best-effort once the stream has failed: an error raised here would replace the one that brought
    // us here, which is the one worth reporting, and the rollback discards the cursor either way.
    const end = failed ? (sql: string) => exec(sql).catch(() => []) : exec;
    await end(`CLOSE ${cursor}`);
    if (ownsTransaction) {
      await end(failed ? 'ROLLBACK' : 'COMMIT');
    }
  }
}
