# Roadmap

What is next, in build order: groundwork first, so the features on top stay small. One rule on every engine, emulated where an engine lacks it, refused only where it cannot be done.

## Groundwork

**R1: an entity with no key.** `meta.ids` cannot be empty yet, and a view often has no key. Every by-id path refuses one by name instead of taking the first column of none. _Unlocks views._

**R2: entity capabilities.** A `readable`/`writable`/`refreshable` set on the entity's type, so a write to something with no table is a compile error. _Unlocks views, read-only queriers._

```ts
await pool.insertOne(WorkspaceUsage, { total: 1 }); // error: not writable
```

**R5: `dialect.compile(query)`.** The SQL and its values without running them, so several statements can be gathered first. _Unlocks batching._

**R7: schema objects as one graph.** `SchemaDiffResult` has a field per kind (`tablesToCreate`, `columnDiffs`, `indexDiffs`, ...), so every new kind adds three fields and a branch in each consumer. Flatten it to `create`/`drop`/`alter` of a `SchemaObject`; ordering is already generic (`createOrder`). _Unlocks views, triggers._

**R7b: a fingerprint per derived object.** Nothing the database derives is diffed today, each settled separately for the same reason: the engine reprints it from a parse tree, so its text never matches what UQL wrote. That covers a check, a partial index's predicate, a stored computed column's expression (introspection reads it on every SQL engine; `schemaASTDiffer` skips it) and, once built, a trigger's body. Compare a hash of what was rendered instead of the reprint: `COMMENT ON` carries it on the Postgres family, SQLite keeps the DDL verbatim already, SQL Server has extended properties, and MongoDB stores the filter document as it was given. One mechanism for four kinds, and the reason a predicate that drifts from its entity is invisible today. _Unlocks diffable checks, index predicates, generated columns and triggers._

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

**Cursor pagination.** `findManyPage(Order, { $sort: { createdAt: -1, id: -1 }, $limit: 50, $after })`, throwing when the sort is not total, which `meta.ids` and the unique indexes prove. The condition is a row-value comparison where the engine has one and a bounded OR chain where it does not: measured, since the plain OR chain scans Postgres from the top and would page no faster than the `$skip` it replaces. `$sort`'s null placements shipped first; what is left is the null arms, `sortsNullsLowest`, and carrying the sort values out to mint a cursor. [The design](cursor-pagination.md).

**Stored triggers** (R7, R7b). Stored aggregates (`computed: (u) => u.resources.count(), stored: true`), then `stored: ['update']` stamps, then authored triggers. Postgres first, then a renderer per SQL engine; MongoDB has no triggers and refuses `stored`. [The design](triggers.md).

**Batching** (R5). One round trip on D1, libSQL/Turso and Neon HTTP, a transaction elsewhere. The shape is undecided. Only reads, `count`, `exists` and a relation-free insert are reliably one statement each, so an entity-level `batch` would promise what the call site cannot show, while a statement-level one over `compile()` loses the typing.

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
- **Nothing derived is diffed until R7b.** A check, a partial index's predicate and a stored computed column's expression are all reprinted by the engine from a parse tree, so changing one emits nothing and a drifted one is invisible. Until the fingerprints land, changing one is a written migration - and an index's `where` is spelled as the predicate the query passes, never as `raw`, or the planner will not match the two.
- **An enum is a column check, not a native type.** So adding a value emits nothing: no engine-wide place holds the list for the differ to compare.
- **A relation's `$limit` is each parent's share.** [The design](relations-in-one-statement.md).
- **A column shape is derived, never copied field by field.** Five hand copies each lost a different option.
- **A relation aggregate is declared, not spelled in a query.** A query-time `$max: { posts: ... }` would add a type parameter per op to all 36 read signatures; a `computed` field does more (`$where`, `$sort`, an exact type) at no such cost. `$sort` keeps the two a declaration cannot: `$count`, and a relation's nearest row to a vector.
- **A nullable column's property admits `null`, and only that.** Family types (`jsonb`, `numeric`) stay narrowable.
- **Every field option states where it applies**, in `FIELD_OPTION_FAMILY`; only contradictions are rejected.
- **No computed vector distance on D1 or MySQL.** Both store vectors as JSON, and a distance over it measured 10 ms to 230 ms a row. D1 points at Vectorize, MySQL at HeatWave.
- **No fuzzy-match or `$max`/`$min` update operator.** Neither has a portable form or a caller `raw` does not already serve.
