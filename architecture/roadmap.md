# Roadmap

The next feature block, in build order. Groundwork first, so the features on top stay small.

## Foundational refactors

Each is small on its own and gates something bigger. None is worth doing for its own sake.

**R1 — an entity with no key.** `meta.ids` is a list that composite keys made plural; it cannot yet be empty. A view often identifies nothing, and every by-id path has to say so rather than take the first column of none. _Unlocks views._

```ts
defineView({ name: 'DailyTotals', ... }); // no @Id to give it
```

**R2 — entity capabilities.** Whether an entity can be read, written or refreshed is not on its type, so nothing stops a write to something that has no table to write to. A `readable`/`writable`/`refreshable` set makes it a compile error instead of a runtime one. _Unlocks views._

```ts
await pool.insertOne(WorkspaceUsage, { total: 1 });
//                   ~~~~~~~~~~~~~~ not writable
```

**R5 — `dialect.compile(query)`.** Building SQL and running it are one step today, so a caller cannot hold the text without executing it - and batching needs exactly that: several statements' text and values, gathered before any of them runs. It also makes the text a memoizable identity. _Unlocks batching._

```ts
const { sql, values } = dialect.compile(User, { $where: { id: 1 } });
```

**R6 — one projection-alias concept.** A read's row type is assembled from pieces that each derive their own: `$select` through `QueryProjectedRow`, `$count` through `CountedRelations` under `_count`, `$agg` through `QueryAggregateResult`. Cursor pagination adds a fourth for its metadata, and `$window` a fifth. Unify the rule once, or every new projection re-derives it. _Unlocks cursor pagination._

```ts
{ $select: { id: true }, $count: { posts: true }, $agg: { total: { $sum: 'amount' } } }
// id from one rule, _count from another, total from a third
```

**R7 — schema objects as a dependency-ordered graph.** Ordering is already generic: `createOrder` in `schema/dependencyGraph.ts` takes any node and a function returning its dependencies. What is not is the diff - `SchemaDiffResult` has a field per kind (`tablesToCreate`, `tablesToDrop`, `columnDiffs`, `indexDiffs`), so a view, a trigger or a policy each add three more and every consumer grows a branch. A `SchemaObject` vocabulary flattens it. _Unlocks views, triggers, RLS policies._

```ts
// now                          // after
tablesToCreate: TableNode[]     create: SchemaObject[]
indexDiffs: IndexDiff[]         drop: SchemaObject[]
...one field per kind           alter: SchemaObjectDiff[]
```

The second kind that R7 waited for has arrived - generated columns in 0.46.0 - so the shape can be derived now rather than guessed.

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

MikroORM 7.1 shipped `AbortSignal` support; UQL has none server-side, though the browser `ClientQuerier` already carries a per-call `signal`. Not scheduled, and the mapping is worse than it looks: only pg, CockroachDB, MySQL and MariaDB can truly cancel, each needing a _second_ connection (`pg_cancel_backend`, `CANCEL QUERY`, `KILL QUERY`) that the querier cannot reach - it holds a `connect` thunk, not the pool. MongoDB is partial: the driver's `Abortable` covers `find`/`aggregate`/`countDocuments` but not `insertMany`/`updateMany`/`bulkWrite`. Every HTTP driver is a dead end rather than a freebie - libsql, Turso Cloud and D1 expose no per-request signal at all - and the synchronous ones (better-sqlite3, `node:sqlite`, PGlite) surface no `interrupt`. Nine write methods also take no options today. The idiom to follow when it happens is `supportsRowLocks` + `assertLockSupported` + `DriverCapabilities`.

- **Published on JSR.** Nearly free - a `jsr.json` and a publish step - and the only one here a user would notice from outside. Worth doing whenever someone wants it; nothing depends on it.
- **`defineEntity` with `extends`.** Decorated classes already inherit fields and hooks from a base; the functional form has no way to say the same. Small, and only matters for the runtime-schema path 0.44.0 opened.
- **Oracle.** SQL Server shipped; Oracle is the half still designed, and a differentiator only Prisma and Drizzle also lack. It needs no R5 - its generated ids ride in the values array - and inherits `MergeSqlDialect`'s paging and upsert. [The design](oracle-mssql.md).
- **Stored procedures and functions.** Not scheduled. A procedure is a schema object like a view, so it would ride on R7, but nothing here asks for one and MikroORM ships it experimental.

## Where a composite key still refuses

Each refuses by name rather than taking the first key column ([the design](https://uql-orm.dev/blog/composite-primary-keys)).

1. **Saving a relation** writes one child column for a whole page; several columns is a statement per parent.
2. **MongoDB** — a compound `_id` is a sub-document whose field order decides equality.
3. **The HTTP `/:id` route** — one path segment, plus a bug: the adapters disagree about percent-decoding. A by-id route does not run `assertIdValue`, but `buildIdQuery` calls `soleIdOf` first, so a composite is refused before it can under-specify one; what is missing there is a nullish guard, which `matchRoute` already makes unreachable.

TypeScript cannot accumulate `@Id` across properties, so the key is named in the class body or not at all: `@Id` refuses one the `idKey` brand and the conventional names both leave unnamed, and `assertIdValue` checks the value at run time.

## Shipped, and not worth re-litigating

One id shape for every write in 0.50.0, upserts included in 0.51.0; per-parent `$limit`/`$skip` on a populated relation in 0.47.0; `computed`/`stored` generated columns in 0.46.0; foreign keys on sync in 0.45.0; composite keys in 0.42.0 and migrations for them in 0.42.1; enums and check constraints in 0.41.1; `raw` as a tagged template in 0.40.0.

- **An id is accepted as either spelling and reported as one.** `EntityId` is the union a by-id method takes, because a caller holding one column's value has to reach the same parameter as one holding a map. `WrittenId` picks a branch, because a write knows which it produced. Merging the two was measured and is worse: it refuses `findOneById(X, 'abc')` on any entity whose key the type level cannot name. `WrittenId` falls back to the union there for the same reason. A `$where` takes neither spelling: it is a map, and `whereIds` is where an id becomes one.
- **The key is a list with nothing beside it.** TypeORM keeps `primaryColumns[0]`, MikroORM a `compositePK` flag; either lets a path address every row agreeing on one column of two. `assertSoleId` is the only way past `meta.ids`, and it throws.
- **Keys and indexes are compared by their columns, never by name.** Matching on names would rewrite every table the first time a naming convention changed.
- **A check is never diffed.** It is SQL text, and a database reprints it from its parse tree. Created with its table; changing one is a hand-written migration. The sync path was built and reverted.
- **An enum is a column check, not a native type.** `CREATE TYPE` needs its own ordering and `ALTER TYPE ... ADD VALUE` is irreversible. The cost: checks are never diffed, so **adding a value emits nothing and the column keeps rejecting it**. No fix spans the matrix; nearly free once the trigger design's `COMMENT ON` emission lands.
- **A generated key is spelled from its declared type.** It was a fixed string per dialect, so `@Id({ columnType: 'int' })` emitted `BIGINT` while the column referencing it emitted `INT`. One rule decides whether a key is generated, and both the schema and the insert path ask it.
- **A relation's `$limit` is each parent's share, not a slice of one page.** Each parent's page is a correlated subquery inside the parent's statement, a `$lookup` sub-pipeline on MongoDB. A `ROW_NUMBER` window sorts every matching child to keep the top few, so its cost rides the axis nobody controls. [The design](relations-in-one-statement.md).
- **A column shape is derived, never listed field by field.** `ColumnSchema` is `ColumnNode` minus the graph links, and each conversion spreads. Five hand-written copies each dropped a different option - `enum`, then `generatedAs`, then `comment` - and a column reached the database without what the entity declared.
- **An unstored `computed` is written out by every clause that names it.** `$sort` used the output alias, so ordering by one you had not selected failed on the server.
- **Every field option states where it applies, in one table.** `FIELD_OPTION_FAMILY` pairs each option with its column family, `deadOn` with what makes it dead. A new option cannot be added without answering both. Only a contradiction is rejected, never a redundancy.
