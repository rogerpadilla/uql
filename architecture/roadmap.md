# Roadmap

What is next, in build order: groundwork first, so the features on top stay small. One rule on every engine, emulated where an engine lacks it, refused only where it cannot be done.

## Groundwork

**R1: an entity with no key.** `meta.ids` cannot be empty yet, and a view often has no key. Every by-id path refuses one by name instead of taking the first column of none. _Unlocks views._

**R2: entity capabilities.** A `readable`/`writable`/`refreshable` set on the entity's type, so a write to something with no table is a compile error. _Unlocks views, read-only queriers._

```ts
await pool.insertOne(WorkspaceUsage, { total: 1 }); // error: not writable
```

**R5: an operation as a plan.** Its statements and how their results read, built without running, and one `runStatements` per querier: a request on D1, Turso Cloud and libSQL, a transaction elsewhere. Makes a split write on D1 atomic. _Unlocks batching._ [The design](batching.md).

**R7: schema objects as one graph.** `SchemaDiffResult` has a field per kind (`tablesToCreate`, `columnDiffs`, `indexDiffs`, ...), so every new kind adds three fields and a branch in each consumer. Flatten it to `create`/`drop`/`alter` of a `SchemaObject`; ordering is already generic (`createOrder`). Internal (`SchemaDiffResult` is not exported), so it can land after 1.0. _Unlocks views._

## Features

**Views and materialized views** (R1, R2, R7).

```ts
export const WorkspaceUsage = defineView({
  name: 'WorkspaceUsage',
  materialized: true,
  from: () => Resource,
  query: { $group: { workspaceId: true }, $select: { total: { $count: '*' } } },
});
```

A view is a read-only entity whose definition is its migration, and its field types come from `QueryAggregateResult`. A materialized view is native on Postgres and CockroachDB (`REFRESH ... CONCURRENTLY`). Elsewhere it is emulated as a table that `refresh` empties and refills in one transaction.

**Batching** (R5). `pool.batch((q) => [q.findMany(...), q.count(...)])`, a typed tuple back, one request where the engine allows it and a transaction elsewhere. [The design](batching.md).

**Read-only queriers** (R2). `ReadonlyQuerierPool<PgQuerier>`, a `Pick` of the read methods, so a write never reaches a replica pool. Types only.

## Later

- **Oracle.** The half of [the design](oracle-mssql.md) not yet built; it inherits `MergeSqlDialect`'s paging and upsert.
- **The maintained aggregate**, `computed: (u) => u.resources.count(), stored: true` kept by triggers on the child, once an unstored one profiles too slow. Only `count` and `sum` turn a row change into a delta, and an aggregate's filter is already row-local, so storing one would change no call site.
- **Schema-scoped objects.** Extensions, functions and domains declared beside the entities (`objects: [{ kind: 'extension', name: 'pg_trgm' }]`), applied by `sync` and `up` before the tables using them; a function is named by its signature. Variability hand-rolls these in four places.

## Settled, not to re-litigate

- **An id is either spelling in, one spelling out.** A by-id method takes `EntityId`, the union; `WrittenId` is the branch a write produced. Merging them refuses `findOneById(X, 'abc')` wherever the key cannot be named.
- **The key is a list.** Every path carries every column of it, a relation's child or junction row included (one column per key column, from `references`). `assertSoleId` refuses the rest by name, never taking the first column: MongoDB (a compound `_id` compares by field order; use a unique compound index) and the HTTP `/:id` route (a composite row is reachable through `$where`).
- **Keys and indexes compare by columns, not names**, so a naming-convention change rewrites nothing.
- **A check is compared by name.** It is installed as `_uql_<table>__<label>_<hash>`, the hash of its SQL, as a trigger is: an edited check is a new name, the old one dropped. Safe mode adds the new one and holds the drop, as it does an index. Only a `_uql_` check is ever dropped; any other is warned about on a table declaring checks.
- **A partial index's predicate and a stored computed column's expression are not diffed**: the engine's reprint never matches what uql wrote, and a fingerprint table is not worth keeping for an edit nobody has made. Changing one is a written migration - and an index's `where` is spelled as the predicate the query passes, never as `raw`, or the planner will not match the two.
- **SQLite alters a table by rebuilding it, foreign keys off.** Dropping the old table with them on deletes every `CASCADE` child and fails a `NO ACTION` one, and `defer_foreign_keys` stops neither; `PRAGMA foreign_keys` only switches outside a transaction. So the migration session switches it around the transaction and runs `foreign_key_check` before commit, and the rebuild carries a guard failing it wherever they stay on (D1, a remote libSQL).
- **An enum is a check, not a native type**: a named table constraint, since MariaDB names a column-level one itself. Changing its values replaces the check like any other.
- **A cursor page compares by the bounded chain `a <= x AND (a < x OR ...)` on every engine**, as a plain `$where`. A row-value comparison wins only on CockroachDB, by under half a millisecond, and only for keys running one way with no null. [The design](cursor-pagination.md).
- **A relation's `$limit` is each parent's share.** [The design](relations-in-one-statement.md).
- **A column shape is derived, never copied field by field.** Five hand copies each lost a different option.
- **A relation aggregate is declared, not spelled in a query.** A query-time `$max: { posts: ... }` would add a type parameter per op to all 36 read signatures; a `computed` field does more (`$where`, `$sort`, an exact type) at no such cost. `$sort` keeps the two a declaration cannot: `$count`, and a relation's nearest row to a vector.
- **A nullable column's property admits `null`, and only that.** Family types (`jsonb`, `numeric`) stay narrowable.
- **Every field option states where it applies**, in `FIELD_OPTION_FAMILY`; only contradictions are rejected.
- **No computed vector distance on D1 or MySQL.** Both store vectors as JSON, and a distance over it measured 10 ms to 230 ms a row. D1 points at Vectorize, MySQL at HeatWave.
- **No fuzzy-match or `$max`/`$min` update operator.** Neither has a portable form or a caller `raw` does not already serve.
