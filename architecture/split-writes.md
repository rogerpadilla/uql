# Split writes

**Built.** Roadmap R5: one path for every statement, so the writes uql splits on its own run all or none, in one request where the engine allows it.

## The problem

- **D1 has no transaction a callback runs in.** It refuses `BEGIN`, so a split write (an `insertMany` past its 100 binds, an `upsertMany` of mixed shapes) sent statement by statement is not atomic: a failure in the third leaves the first two written. Its `db.batch()` runs a list of statements as one transaction.
- **Over HTTP, a statement is a round trip.** On Turso Cloud and remote libSQL a transaction sent statement by statement is `BEGIN`, each statement, then `COMMIT`: n + 2 requests, where `session.batch(statements, mode)` and `client.batch(statements, 'write')` run the list atomically in one. On Neon a WebSocket session pays the same, and an edge runtime cannot keep one past a request, where its HTTP `transaction([...])` runs a list in one.

## The design

### One path for every statement

Every statement a SQL querier sends goes through one protected method of its own, `runStatements(statements)`, answering a result per statement, all or none: on SQL, in turn, in a transaction where two or more write, or through the driver's optional `executeBatch` as one request. A method's code after its `await this.runStatements(...)` is its read: hydration, ids, counts and hooks stay where they are. No plan objects: a plan per operation would split each method's hooks, ids and `returning` into combinators, with the read-dependent paths left in a second style.

A statement is `{ sql, values }`. A driver answers two methods: `execute(sql, values)`, one statement's `{ rows, changes, id }` (the rows it read, how many it changed, and the first id a header reports), and, where it takes a list as one atomic request, the optional `executeBatch(statements)`. A statement returning rows counts them, whatever the driver's own count says, so every driver answers the same.

| Engine                 | `runStatements` of several                                                                     |
| :--------------------- | :--------------------------------------------------------------------------------------------- |
| D1                     | `db.batch()`: one request, one transaction                                                     |
| Turso Cloud            | `session.batch(statements, 'immediate')`; inside an open transaction, no mode, so it joins it  |
| libSQL                 | `client.batch(statements, 'write')`; inside an open transaction, the transaction's own `batch` |
| Neon                   | over HTTP, `sql.transaction([...])`; inside an open transaction, its WebSocket session in turn |
| every other SQL engine | each in turn, in a transaction that joins an open one where two or more write                  |

One statement runs alone everywhere. A list asks for a transaction only where it is a split write, `runStatements(statements, atomic)`: an `insertMany` sent as two or more statements, an `upsertMany` of two or more upserts. The `SET`s tuning a vector search and its read need none on one connection, and cost Postgres and MySQL no `BEGIN` and `COMMIT`.

`runStatements` is the outermost step a statement takes, in this order: a list with no `executeBatch` where two or more write opens its transaction, whose `BEGIN` waits on the querier's queue; then the queue is taken, the connection made, and the driver runs the statement, the list in turn, or the list as one request, timed as one.

The `SET LOCAL`s tuning a vector search lead its read's list. An upsert's read-back of ids by its conflict columns follows its statements, for the rows they placed no id on and that do not keep their own key: where the engine cannot report ids in order (MySQL reports one row's own, assigning a found row's key through `LAST_INSERT_ID`), or the upsert assigns nothing and so may skip rows. `findManyAndCount`'s count for an empty page stays where it is, after the page, as deciding it up front would add a count to every paged call. `atomically` remains only where the writes depend on a read; on D1 those run unguarded, and `transaction()` stays refused there.

### Neon over HTTP first

`NeonQuerierPool` holds both of Neon's transports, and its querier picks per call:

| What                                                                                   | Transport                                                                     |
| :------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------- |
| a statement, and a list of them outside a transaction (a split write)                  | HTTP: `sql.query`, and `sql.transaction([...])` for a list                    |
| `transaction()`, `beginTransaction()` (`$lock` and `$candidates` inside one), a stream | a WebSocket session from its `Pool`, serving the querier until it is released |
| a migration                                                                            | a WebSocket session throughout, since its lock is the session's               |

HTTP needs only `fetch`, so the same pool runs on Node, Bun, Deno and Workers; on an edge runtime a WebSocket session stays inside one request, as Neon requires. A list inside an open transaction runs in turn on its session, which it joins; outside one it is an HTTP transaction, even on a querier holding a session. Neon ignores `types` given to `neon()`, so every query passes the pool's wire types itself, and a timestamp decodes as it does over the wire protocol rather than in the process's time zone. Each query is awaited once: a Neon query re-runs on every `then`. Neon's proxy binds at most 32,767 values a statement over HTTP, half what Postgres takes, which the pool's `NeonDialect` states, so a write splits within it and a message names Neon. A Neon error carries the Postgres code, which `queryErrorKind` reads as it reads `pg`'s.

## Not in this change

- **One request on Postgres, MySQL and SQL Server.** Each runs `runStatements` as a transaction over one connection, where round trips are cheap. `pg`'s pipelining can send `BEGIN`, the statements and `COMMIT` in one round trip, but it refuses cursors and answers a failed list's `COMMIT` as resolved; mysql2's multiple statements leave a failed transaction open. Either would be a driver concern, behind the same method.
- **An atomic MongoDB `upsertMany` with an `update`.** Its two calls a row run in turn, row by row; `client.bulkWrite` is not transactional.
- **Dependent writes in one request.** A cascade inserting children needs the parent's id, unless every key is generated client-side (`onInsert`). Planning that is possible but is a separate step, worth taking only when a profile asks for it.
