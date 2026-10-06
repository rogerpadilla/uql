# Batching

**Not built.** Roadmap R5 and its batching feature, settled together: one primitive serves the writes uql splits on its own and a public `batch`.

## The problem

- **A split write on D1 is not atomic.** An `insertMany` past D1's 100 binds, an `upsertMany` of mixed shapes, an `updateMany` or `deleteMany` past one statement's key list: each runs as several statements, and `D1Querier.atomically` runs them one by one, since D1 refuses `BEGIN`. A failure in the third leaves the first two written. Yet D1's own `db.batch()` runs a list of statements as one transaction.
- **A split write over HTTP pays a round trip per statement.** On Turso Cloud and remote libSQL it is `BEGIN`, each statement, then `COMMIT`: n + 2 requests. `Session.batch(statements, mode)` and `client.batch(statements, 'write')` run the same list atomically in one.
- **Nothing lets a caller send several queries in one request.** A page's reads, or a read and the write it guards, cost a round trip each on every HTTP engine.

## What others do

|                                      | API                   | One request on                                                                | Typing                              |
| :----------------------------------- | :-------------------- | :---------------------------------------------------------------------------- | :---------------------------------- |
| Drizzle (beta)                       | `db.batch([...])`     | D1, libSQL, Neon HTTP, its Postgres HTTP driver; not its Turso serverless one | a tuple, from lazy query builders   |
| Prisma 7                             | `$transaction([...])` | none: a transaction around them                                               | a tuple, from lazy `PrismaPromise`s |
| Prisma 8                             | none                  |                                                                               | the rewrite dropped the array form  |
| Kysely, MikroORM, TypeORM, Sequelize | none                  |                                                                               |                                     |

Both shapes that exist rest on a query that is a value before it runs. A uql querier method runs when called, which is why the roadmap found only two shapes: an entity-level `batch` promising one statement per call that the call site cannot show, or a statement-level one over raw SQL that loses the types.

## Measured usage

Every `atomically` call site, by whether its statements are known before the first runs:

| Call site                                | Statements known up front       |
| :--------------------------------------- | :------------------------------ |
| `insertMany` past the bind or row cap    | yes: chunks of the payload      |
| `upsertMany` of several shapes           | yes: a statement per shape      |
| `writeBatches`, an update by settled ids | yes, once the ids are read      |
| `writeBatches`, a delete with relations  | no: each batch reads first      |
| a guarded upsert, a mixed `saveMany`     | no: the reads decide the writes |

So the splits that matter are lists of independent statements, the only thing a batch can carry. The rest stay on a transaction.

## The design

### A plan, then a run

An operation compiles to a **plan**: its statements, each SQL and values, and a `read` turning their results into what the method returns (hydration, ids, counts). Building one runs nothing. This is R5's `compile`, but per operation rather than per query, since one operation may be several statements.

A querier runs a plan through one method, `runStatements(statements)`, answering a result per statement, all or none:

| Engine                          | `runStatements`                                                                                |
| :------------------------------ | :--------------------------------------------------------------------------------------------- |
| D1                              | `db.batch()`: one request, one transaction                                                     |
| Turso Cloud                     | `session.batch(statements, 'immediate')`; inside an open transaction, no mode, so it joins it  |
| libSQL                          | `client.batch(statements, 'write')`; inside an open transaction, the transaction's own `batch` |
| every other engine, MongoDB too | each statement in turn, in a transaction that joins an open one: today's `atomically`          |

`atomically` remains only for the call sites whose writes depend on a read. On D1 those still run unguarded, as now, and the refusal for an interactive transaction stays.

### The public `batch`

```ts
const [posts, total] = await pool.batch((q) => [
  q.findMany(Post, { $select: { title: true }, $limit: 20 }),
  q.count(Post, { $where: { published: true } }),
]);
```

- **`q` is a `BatchQuerier`**, a `Pick` of the querier's methods that can be planned. `Pick` keeps each member's own type, overloads and generics included, so the result types, projections and both call forms carry over with nothing restated. Each call returns its own promise, which settles when the batch has run.
- **The callback cannot await.** `batch` takes `(q) => readonly Promise<unknown>[]`, so an `async` callback, which returns a promise of an array, is a compile error. Awaiting one of the promises inside would wait on a batch that has not run.
- **A call that cannot be planned throws as it is made**, a `UqlUsageError` naming the method and the reason: a cascade, a `$where` reaching a relation on an engine without `correlatedWrites`, a security filter that reads before it writes. The method set is fixed at compile time; these are the cases only the arguments reveal.
- **The statements run in order, all or none,** so a read sees the writes before it.
- **Hooks keep their places.** Each call's `before` hooks run while the batch is assembled, and the batch awaits them before it runs; the `after` hooks run once it has.
- **On `pool` and on a querier.** A querier inside an open transaction batches into it.

Verified with `tsc --strict` on a model of the types: the tuple comes back typed, a projection narrows its rows, and both the `async` callback and a `transaction` call are refused.

## Build order

Each step is checkable on its own:

1. **Plans under every SQL write and read**, run through `runStatements` with the sequential default. No behaviour changes: the full suite is the gate.
2. **`runStatements` on D1, Turso Cloud and libSQL**, and the split writes through it. Held by a test per engine counting one request for a split `insertMany`, and on D1 by one failing on its last chunk and leaving nothing written.
3. **`batch` and `BatchQuerier`**, with `batch.test-d.ts` pinning the tuple, the projection and the two compile errors, and a shared suite case for each refusal.

## Not in this change

- **Neon over HTTP.** uql reaches Neon by WebSocket only. Its HTTP driver's `transaction([...])` would plug into `runStatements` once it is supported.
- **One request on Postgres, MySQL and SQL Server.** Each runs `runStatements` as a transaction over one connection, where round trips are cheap. Pipelining (`postgres.js`) or a multi-statement request would be a driver concern, behind the same method.
- **Dependent writes in one request.** A cascade inserting children needs the parent's id, unless every key is generated client-side (`onInsert`). Planning that is possible but is a separate step, worth taking only when a profile asks for it.
