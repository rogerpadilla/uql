# Roadmap

The next feature block, in build order. Groundwork first, so the features on top stay small.

## Foundational refactors

**R1 — zero key columns.** The composite half shipped; left is zero, for a relation nothing identifies. _Unlocks views._

**R2 — entity capabilities.** A `readable`/`writable`/`refreshable` set brands read-only on the type, so writing to a view is a compile error. _Unlocks views._

**R5 — `dialect.compile(query) -> { sql, values }`.** Makes the SQL text a memoizable identity. _Unlocks batching._

**R6 — one projection-alias concept.** `$agg` aliases, `_count`, cursor metadata and a future `$window` each derive their result type separately. Unify, or `$window` adds a fourth. _Unlocks cursor pagination._

**R7 — schema objects as a dependency-ordered graph.** Step 1 done: the table-only topological sort in `schema/dependencyGraph.ts`, generic over node and edge. Left: a `SchemaObject` vocabulary, and flattening `SchemaDiffResult`'s one-field-per-kind. Both wait for a second kind, so the shape is derived rather than guessed. _Unlocks views, triggers, RLS policies._

## Views and materialized views

```ts
export const WorkspaceUsage = defineView({
  name: 'WorkspaceUsage',
  materialized: true,
  from: () => Resource,
  query: { $group: { workspaceId: true }, $agg: { total: { $count: '*' } } },
});
```

R2, R7. A view is an entity, just read-only — which dissolves the "relation with no entity" problem that makes CTEs a poor fit. Field types fall out of `QueryAggregateResult`; the definition is the migration. `REFRESH ... CONCURRENTLY` on Postgres/CockroachDB, refused elsewhere.

## Cursor pagination

```ts
await pool.findManyPage(Order, { $sort: { createdAt: -1, id: -1 }, $limit: 50, $after: cursor });
```

R6. Row-value comparison where available, an OR-chain elsewhere, compound `$lt` on Mongo. **Throw when the sort is not total** — a keyset page that silently skips or repeats rows is worse than an error.

## Triggers

```ts
@Field({ computed: { resources: { $count: '*' } }, stored: true })        resourceCount?: number;
```

The generated-column arm of `computed`/`stored` shipped; left are the trigger-backed arms, which need R7 and are Postgres only. The maintained aggregate is the case worth declaring rather than authoring: it is the only one that generates the reparent branch every hand-written version forgets. [The design](triggers.md).

## Per-parent limits on a populated relation

```ts
$populate: { posts: { $sort: { createdAt: -1 }, $limit: 5 } };
```

`$limit`/`$skip` inside a to-many `$populate` cap the whole result set today, not each parent's share, so a parent that has children can come back with `[]`. The docs call that inherent; it is not. One bounded subquery per parent key concatenated with `UNION ALL` is universal and reads `parents x (skip + limit)` rows, with a `LATERAL` override on `PgLikeSqlDialect` as a second increment. A fix rather than a behaviour change, so it ships in a minor. No R7 dependency. [The design](populate-limits.md).

## Typed DDL predicates

```ts
@Index(['email'], { where: { deletedAt: null } })
```

A partial index's `where` is `string | QueryRaw` today. Widening it to a `QueryWhere<E>` compiled at DDL time makes a typo a compile error instead of SQL that parses and never matches, and MikroORM 7.1 reached the same conclusion for its partial indexes. `checks` can take one on the same terms, and MongoDB's `partialFilterExpression` is the shape `MongoDialect.where` already returns. Compile in `buildEntityAST`, which has a dialect, rather than at registration, which does not - so `IndexSchema.where` stays a string and nothing downstream changes. Shares the interpolated-`raw` DDL render path that [triggers](triggers.md) needs.

Two things to get right when it lands. DDL carries no placeholders, so literals inline: every binding site funnels through `QueryDialect.addValue`, so one override returning `escape(value)` covers nearly all of it, but `PgLikeSqlDialect.formatIn` (binds the array for `= ANY($1)`), `jsonScalarParam` (hard-codes `'?'`) and `appendVectorValue` bypass it and need their own arms - assert `ctx.values.length === 0` afterwards so a missed site fails loudly instead of emitting `$1` into a `CREATE INDEX`. And refuse what a predicate cannot carry there: relation operators, `$size`, `$text`, `$near`, and `security` filters, which `{ filters: false }` deliberately does not disable.

## Row-level security

Postgres and PGlite only. Two halves, and the first needs no R7: session context — `set_config`/`set local role` before each statement, transaction-scoped, exactly the shape `applyVectorTuning` already has. That alone makes hand-written policies (Supabase) usable from UQL. Declared `policies` are schema objects and wait for R7.

Skip a connection-scoped strategy: a pooled connection carrying the previous tenant's context is a cross-tenant leak.

## Batching

```ts
const [users, total] = await pool.batch((q) => [q.findMany(User, { $limit: 10 }), q.count(User)]);
```

R5. One round trip on D1, libSQL/Turso and Neon HTTP; `BEGIN`/`COMMIT` and N round trips elsewhere — correct, not faster.

**The entity-level API cannot keep its promise.** Only `count`, `exists` and the inserts are reliably one statement: `findMany` issues extras for to-many relations, `updateMany`/`deleteMany` run hooks and cascades. A caller cannot tell from the call site. The honest shape is statement-level over `compile()`, which gives up the typing that makes the rest of the API worth using. Decide before building either.

## Query cancellation

Kysely 0.29 and MikroORM 7.1 both shipped `AbortSignal` support; UQL has none server-side, though the browser `ClientQuerier` already carries a per-call `signal`. Not scheduled, and the mapping is worse than it looks: only pg, CockroachDB, MySQL and MariaDB can truly cancel, each needing a _second_ connection (`pg_cancel_backend`, `CANCEL QUERY`, `KILL QUERY`) that the querier cannot reach - it holds a `connect` thunk, not the pool. MongoDB is partial: the driver's `Abortable` covers `find`/`aggregate`/`countDocuments` but not `insertMany`/`updateMany`/`bulkWrite`. Every HTTP driver is a dead end rather than a freebie - libsql, Turso Cloud and D1 expose no per-request signal at all - and the synchronous ones (better-sqlite3, `node:sqlite`, PGlite) surface no `interrupt`. Nine write methods also take no options today. The idiom to follow when it happens is `supportsRowLocks` + `assertLockSupported` + `DriverCapabilities`.

## Where a composite key still refuses

Each refuses by name rather than taking the first key column ([the design](https://uql-orm.dev/blog/composite-primary-keys)).

1. **The id an insert reports** — a composite insert has nothing to report: the caller wrote every key column, so `idOf(meta, row)` already names the row from the payload it passed in. Handing back a key map instead widens `insertOne`'s return type for every entity (139 errors in this repo, all single-key `const id = await insertOne(...)`; the narrower `IdValue | map` union still costs 58). Revisit only as an opt-in that leaves the single-key return narrow, the way Drizzle's `$returningId()` does.
2. **`saveMany`** reads an id as proof the row exists, which a composite carries on an insert too. Telling the two apart is upsert's job.
3. **Saving a relation** writes one child column for a whole page; several columns is a statement per parent.
4. **MongoDB** — a compound `_id` is a sub-document whose field order decides equality.
5. **The HTTP `/:id` route** — one path segment, plus two bugs: the adapters disagree about percent-decoding, and a by-id route never runs `assertIdValue`, so a partial composite addresses every row agreeing on the columns it named, `DELETE` included.

Types stay permissive: TypeScript cannot accumulate `@Id` across properties, so the `idKey` brand is the opt-in and `assertIdValue` is what everyone else gets.

## Shipped, and not worth re-litigating

`computed`/`stored` generated columns and foreign keys on sync in 0.45.0; composite keys in 0.42.0 and migrations for them in 0.42.1; enums and check constraints in 0.41.1; `raw` as a tagged template in 0.40.0.

- **The key is a list with nothing beside it.** TypeORM keeps `primaryColumns[0]`, MikroORM a `compositePK` flag; either lets a path address every row agreeing on one column of two. `assertSoleId` is the only way past `meta.ids`, and it throws.
- **Keys and indexes are compared by their columns, never by name.** Matching on names would rewrite every table the first time a naming convention changed.
- **A check is never diffed.** It is SQL text, and a database reprints it from its parse tree. Created with its table; changing one is a hand-written migration. The sync path was built and reverted.
- **An enum is a column check, not a native type.** `CREATE TYPE` needs its own ordering and `ALTER TYPE ... ADD VALUE` is irreversible. The cost: checks are never diffed, so **adding a value emits nothing and the column keeps rejecting it**. No fix spans the matrix; nearly free once the trigger design's `COMMENT ON` emission lands.
- **A generated key is spelled from its declared type.** It was a fixed string per dialect, so `@Id({ columnType: 'int' })` emitted `BIGINT` while the column referencing it emitted `INT`. One rule decides whether a key is generated, and both the schema and the insert path ask it.
- **A column shape is derived, never listed field by field.** `ColumnSchema` is `ColumnNode` minus the graph links, and each conversion spreads. Five hand-written copies each dropped a different option - `enum`, then `generatedAs`, then `comment` - and a column reached the database without what the entity declared.
- **An unstored `computed` is written out by every clause that names it.** `$sort` used the output alias, so ordering by one you had not selected failed on the server.
- **Every field option states where it applies, in one table.** `FIELD_OPTION_FAMILY` pairs each option with its column family, `deadOn` with what makes it dead. A new option cannot be added without answering both. Only a contradiction is rejected, never a redundancy.
