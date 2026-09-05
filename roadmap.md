# Roadmap

The next feature block, in build order. Groundwork first, so the features depending on it stay small.

## Foundational refactors

**R1 — zero key columns.** The composite half shipped: `meta.ids` is the only stored form, and
`EntityId<E>` is a scalar for one key, an object for several. Left is zero, for a relation nothing
identifies. Unlocks views.

**R2 — entity capabilities.** `@Entity` means "table". A `readable`/`writable`/`refreshable` set makes
a read-only relation expressible and brands it on the type, so writing to a view is a compile error.
Unlocks views, matviews, future CTEs.

**R5 — `dialect.compile(query) -> { sql, values }`.** Makes the SQL text a memoizable identity, which
is the whole prerequisite for prepared statements and batching.

**R6 — one projection-alias concept.** `$agg` aliases, `_count`, and the proposed `$window` aliases and
cursor metadata each carry their own result-type derivation. Unify, or `$window` adds a third. Unlocks
cursor pagination.

**R7 — schema objects as a dependency-ordered graph.** Step 1 done: the table-only topological sort is
`schema/dependencyGraph.ts` (`createOrder`, `dropOrder`, `findCycles`), generic over any node and an
edge function. Cycle tolerance is deliberate - a cyclic FK is legal SQL, handled by deferring the
constraint. Left: a `SchemaObject` vocabulary, and flattening `SchemaDiffResult`, which carries one
field per kind. Both wait for a second kind, so the shape is derived rather than guessed. Unlocks
enums, views, triggers.

## Views and materialized views

```ts
export const WorkspaceUsage = defineView({
  name: 'WorkspaceUsage',
  materialized: true,
  from: () => Resource,
  query: { $group: { workspaceId: true }, $agg: { total: { $count: '*' } } },
});
```

Depends on R2, R7. A view is an entity, just read-only - which dissolves the "relation with no
entity" problem that makes CTEs a poor fit. Field types fall out of `QueryAggregateResult`, so
nothing is restated; writes are a compile error; the definition is the migration, instead of raw SQL
hidden in a migration file. `REFRESH ... CONCURRENTLY` on Postgres/CockroachDB, refused elsewhere
rather than silently downgraded.

## Generated stored columns

```ts
@Field({ type: String, virtual: raw`...`, stored: true }) fullName?: string;
```

One flag on the existing option. `$where`/`$sort`/`$select` behave identically either way; `stored`
trades disk for a real, **indexable** column, so it is a dial you flip after profiling without
touching a call site. Drizzle makes these two unrelated APIs. Postgres 12+, MySQL 5.7+, MariaDB
5.2+, SQLite 3.31+; Mongo refuses.

## Cursor pagination

```ts
await pool.findManyPage(Order, { $sort: { createdAt: -1, id: -1 }, $limit: 50, $after: cursor });
```

Depends on R6. A row-value comparison where available, an OR-chain elsewhere, a compound `$lt` on
Mongo. **Throw when the sort is not total** (last key not a primary or unique key): a keyset page
that silently skips or repeats rows under concurrent writes is worse than an error, and fail-closed
matches how `security` filters behave.

## Triggers

Variability maintains ~20 counter columns via trigger functions written as raw SQL in migrations,
invisible to `uql-migrate` diff and drift. Depends on R7. Make them **visible to the diff** first so
drift is reported, before making them authorable.

## Batching

```ts
const [users, total] = await pool.batch((q) => [q.findMany(User, { $limit: 10 }), q.count(User)]);
```

Depends on R5. One round trip on D1, libSQL/Turso and Neon HTTP; `BEGIN`/`COMMIT` and N round trips
on `pg`, `mysql2`, `mariadb` - correct, not faster.

**The entity-level API cannot keep its promise.** Most querier methods are not one statement:
`findMany` issues extra queries for to-many relations, `$count` and `$candidates`; `updateMany` and
`deleteMany` run lifecycle hooks - arbitrary user code that may itself query - and deletes cascade.
Only `count`, `exists` and the inserts are reliably single, and a caller cannot tell from the call
site: add `$populate` of a to-many and the batch quietly becomes several round trips.

The honest shape is statement-level, `pool.batch([{ sql, values }, ...])` over `compile()`, which
guarantees the round trip but gives up the typing that makes the rest of the API worth using. Decide
which is wanted before building either.

## Server-side prepared statements

Opt-in per pool, **default off**: session-level prepared statements break transaction-mode poolers,
which is currently advertised as a feature. Depends on R5 - the same query shape compiles to a
byte-identical string, so that string is the cache key with no fingerprinting. `IN`-list arity and
`insertMany` chunking would thrash the cache; cap it and skip variadic statements.

## Where a composite key still refuses

Composite keys shipped ([the design](https://uql-orm.dev/blog/composite-primary-keys)). These five
paths identify a row through a single slot, so each refuses by name rather than falling back to the
first key column.

1. **The id an insert reports.** Returning the key map widens `insertOne`'s _return_ type for every
   entity - 139 errors across this repo alone, all single-key code doing `const id = await insertOne(...)`.
   Revisit only with a way to keep the single-key return narrow.
2. **`saveMany`** reads an id as proof the row exists, which a composite carries on an insert too.
   Telling an insert from an update takes a read, which is upsert's job.
3. **Saving a relation** writes the parent's key into one child column for a whole page. Several
   columns per parent is a statement per parent.
4. **MongoDB** - a compound `_id` is a sub-document whose field order decides equality, so a write
   would store the columns flat where no read looks for them.
5. **The HTTP `/:id` route** - one path segment, and two bugs to settle first. The adapters disagree
   about percent-decoding (`fetchHandler` splits an encoded `url.pathname`, express hands over a
   decoded `req.params`), and a by-id route never runs `assertIdValue` at all, so a partial composite
   would address every row agreeing on the columns it named - on a `DELETE` too. Move the check into
   `buildIdQuery`, then encode as JSON, parsed iff `meta.ids.length > 1` so metadata decides the shape
   rather than sniffing the string.

Types stay permissive: TypeScript cannot accumulate `@Id` across properties into the class type, so the
`idKey` brand is the opt-in for compile-time enforcement and `assertIdValue` is what everyone else gets.

## Shipped

**Composite primary keys** landed in 0.42.0, and migrations that can change one in 0.42.1. **Enum
fields** and **check constraints** in 0.41.1; `raw` as a tagged template and the one expression type in
0.40.0. Decisions from those worth not re-litigating:

- **The key is a list with nothing beside it.** TypeORM keeps `primaryColumns[0]`, MikroORM a
  `compositePK` flag; either lets a path take the first of two columns and address every row agreeing
  on it. `assertSoleId` is the only way past `meta.ids`, and it throws.
- **Keys and indexes are compared by their columns, never by name.** The engine named every constraint
  that already exists, so matching on names would rewrite every table the first time a naming
  convention changed - and would never match a name an engine truncated or invented.

- **A check is never diffed.** It is SQL text, and a database reprints text from its parse tree, so a
  diff could only match names - and only PostgreSQL reports checks at all. A check is created with its
  table; changing one is a hand-written migration. The sync path was built and reverted.
- **An enum is a column check, not a native type.** `CREATE TYPE` is a second schema object needing
  its own ordering, and Postgres's `ALTER TYPE ... ADD VALUE` is irreversible while removing a value
  rewrites every dependent column. A column check makes adding a value an ordinary column change.
