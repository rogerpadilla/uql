# Roadmap

What is next, in build order: groundwork first, so the features on top stay small. One rule on every engine, emulated where an engine lacks it, refused only where it cannot be done.

## Groundwork

**R1: an entity with no key.** `meta.ids` cannot be empty yet, and a view often has no key. Every by-id path refuses one by name instead of taking the first column of none. _Unlocks views._

**R2: entity capabilities.** A `readable`/`writable`/`refreshable` set on the entity's type, so a write to something with no table is a compile error. _Unlocks views, read-only queriers._

```ts
await pool.insertOne(WorkspaceUsage, { total: 1 }); // error: not writable
```

**R5: an operation as a plan.** Its statements and how their results read, built without running, and one `runStatements` per querier: a request on D1, Turso Cloud and libSQL, a transaction elsewhere. Makes a split write on D1 atomic. _Unlocks batching._ [The design](batching.md).

**R7: schema objects as one graph.** `SchemaDiffResult` has a field per kind (`tablesToCreate`, `columnDiffs`, `indexDiffs`, ...), so every new kind adds three fields and a branch in each consumer. Flatten it to `create`/`drop`/`alter` of a `SchemaObject`; ordering is already generic (`createOrder`). _Unlocks views, triggers._

**R7b: a fingerprint per derived object.** What the engine reprints from a parse tree never matches the text UQL wrote, so it cannot be compared against the reprint. Triggers and checks needed no fingerprint: each is installed under a name ending in a hash of its SQL, and comparing names is the whole diff. Two kinds cannot carry one, since the name is the author's: a partial index's predicate (indexes compare by columns, never names) and a stored computed column's expression (introspection reads it on every SQL engine; `schemaASTDiffer` skips it). For those, store what was rendered in a `uql_schema_objects` table keyed by table, kind and name, and compare against that. _Unlocks diffable index predicates and generated columns._

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

**Stored triggers.** Authored triggers and `stored: ['update']` stamps shipped, on every SQL engine, needing neither R7 nor R7b: a trigger is recreated rather than diffed, and the engine keeps the render a rollback puts back. What is left is the maintained aggregate (`computed: (u) => u.resources.count(), stored: true`), held back until an unstored one profiles too slow. MongoDB runs no trigger within a write and refuses them. [The design](triggers.md).

**Batching** (R5). `pool.batch((q) => [q.findMany(...), q.count(...)])`, a typed tuple back, one request where the engine allows it and a transaction elsewhere. [The design](batching.md).

**Read-only queriers** (R2). `ReadonlyQuerierPool<PgQuerier>`, a `Pick` of the read methods, so a write never reaches a replica pool. Types only.

## Later

- **Oracle.** The half of [the design](oracle-mssql.md) not yet built; it inherits `MergeSqlDialect`'s paging and upsert.
- **Ranked retrieval.** A weighted sum of several vector distances, some over a relation's nearest rows. Each piece renders today; the arithmetic across them waits for a second caller.
- **JSR.** A `jsr.json` and a publish step, whenever someone asks.

## Where a composite key still refuses

Each by name, never by taking the first key column: saving a relation (one child column per page), MongoDB (a compound `_id` compares by field order), and the HTTP `/:id` route (one path segment).

## Settled, not to re-litigate

- **An id is either spelling in, one spelling out.** A by-id method takes `EntityId`, the union; `WrittenId` is the branch a write produced. Merging them refuses `findOneById(X, 'abc')` wherever the key cannot be named.
- **The key is a list, and `assertSoleId` is the only way past it.** A first-column shortcut would address every row that agrees on one column of two.
- **Keys and indexes compare by columns, not names**, so a naming-convention change rewrites nothing.
- **A check is compared by name.** It is installed as `_uql_<table>__<label>_<hash>`, the hash of its SQL, as a trigger is: an edited check is a new name, the old one dropped. Safe mode adds the new one and holds the drop, as it does an index. Only a `_uql_` check is ever dropped; any other is warned about on a table declaring checks.
- **A partial index's predicate and a stored computed column's expression are not diffed until R7b.** Changing one is a written migration - and an index's `where` is spelled as the predicate the query passes, never as `raw`, or the planner will not match the two.
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
