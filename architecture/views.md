# Views

**Steps 1 and 2 are built**: `defineView` declares a view as a query, and uql reads a plain one by it on every engine. Left: materialized views (step 3) and installing views in the database for every other tool, a MongoDB view collection included (step 4). Until step 3, `defineView` takes no `materialized` and a view no `indexes`.

A view mapped by hand as a read-only entity, its SQL written and migrated outside uql, leaves its columns typed by hand, its SQL unchecked when the tables it reads change, and nothing to say when the database's copy went stale. `defineView` is the answer.

## Where the others stand

Surveyed 2026-11-19 on each clone's latest upstream commit in `~/projects` (Drizzle on `main` and `beta`, Prisma ORM and `prisma-engines`).

|                | Declared as                                   | Row type                    | Change detected by                         | Applied as                                                     | Order                              | A column it reads altered   |
| -------------- | --------------------------------------------- | --------------------------- | ------------------------------------------ | -------------------------------------------------------------- | ---------------------------------- | --------------------------- |
| Drizzle (beta) | query builder, or `sql` with declared columns | inferred                    | its last snapshot (push ignores it)        | drop and create (`OR REPLACE` on MySQL, `ALTER VIEW` on MSSQL) | from the query tree, creates only  | not handled                 |
| MikroORM       | entity, `expression` as SQL or a builder      | declared                    | the database's text, normalised by regexes | drop and create                                                | view names matched in the SQL text | not handled                 |
| TypeORM        | `@ViewEntity`, SQL or a builder               | declared                    | its text stored in `typeorm_metadata`      | drop and create, with `dependsOn`                              | manual `dependsOn`                 | not handled                 |
| Prisma         | `view` block, SQL written by introspection    | declared                    | not diffed                                 | dropped on reset only                                          | none                               | names the views blocking it |
| Kysely         | DDL builder only                              | the hand-written `Database` | none                                       | hand-written                                                   | none                               | none                        |

None recreates a view around a change to a table it reads, the commonest failure: Postgres refuses to alter a column a view reads, and SQLite's table rebuild orphans it. Matching the database's own text by regexes is fragile, since Postgres and MySQL rewrite a view's SQL, and a stored copy of the definition cannot see a hand edit. Every one reads a view through the database object, so a view over rows a policy holds is held only where the engine passes the caller's rights through, and not at all where the ORM enforces the policy.

The schema tools do better: they let the engine normalise both sides. [Atlas](https://www.atlasgo.io/declarative/diff) creates the desired objects in an empty dev database of the same engine and reads them back; Stripe's [pg-schema-diff](https://github.com/stripe/pg-schema-diff) loads the desired DDL into a temporary database to read its schema as Postgres stores it; Prisma Migrate replays its migration history into a shadow database and introspects that (`sql_schema_from_migration_history`), though not for views, which it never diffs. No ORM surveyed normalises a view through the engine. The database stays the one source of truth.

## The view

```ts
export const WorkspaceUsage = defineView({
  name: 'WorkspaceUsage',
  from: () => Resource,
  aggregate: { $group: { workspaceId: true }, $select: { total: { $count: '*' }, size: { $sum: { bytes: true } } } },
  materialized: true,
}).relations((rel) => ({
  workspace: () => rel.manyToOne(Workspace, { references: (usage) => usage.workspaceId }),
}));
export interface WorkspaceUsage extends InstanceType<typeof WorkspaceUsage> {}

await pool.findMany(WorkspaceUsage, { $where: { total: { $gt: 100 } }, $populate: { workspace: true } });
await pool.refreshView(WorkspaceUsage);
```

- **Its query is `aggregate` or `find`, over `from`, captured as `const Q`**: an aggregate exactly as `pool.aggregate` takes it, its row `QueryAggregateResult<Source, Q>`; or a find, a filtered projection such as published posts, its row `QueryFindResult<Source, Q>`. A find is `ViewFind`, the whole `Query` with its typed `$select`, less what a flat row cannot hold: `$populate` and `$count` would nest into it, `$select`'s SQL list types none, and `$lock` belongs to a read. Neither takes paging (`$sort`, `$candidates`, `$skip`, `$limit`): a view is a set of rows, a read orders and pages it, and SQL Server refuses an unpaged sort in a derived table. So `$distinct` and any clause `Query` gains later reach a view by default. Two keys rather than one `query`: each is typed by the one query type it takes, so a typo fails as sharply as in the method, and nothing guesses which it is. A query is data, so a view travels in the schema document as its source's name and its query.
- **Its key is what keeps a row unique**: a find's is its source's key, so its relations carry over; an aggregate's is its `$group` columns when every one is NOT NULL, since NULL groups are not unique. A view keyed so is read by id and joined to-one, and a materialized one refreshes by it. Any other has no key.
- **A column keeps the key it holds**: one read off its source's key, or off a column referencing another entity's, `references` that entity, so it filters and decodes as that key (an `ObjectId` on MongoDB) and a relation can join by it. No foreign key is installed from or onto a view: its query decides its rows, and a refresh rewrites a materialized one's.
- **It is `readOnly`**, branded and refused as any read-only entity is; its `wire` takes `'read'` alone.
- **Data alone, no `@View`.** A decorator cannot type its class from a query. Sections chain as on `defineEntity`: `relations`, `filters`, `policies`, and `indexes` on a materialized view.
- **Read like any entity**: find, count, aggregate, `$where`, `$sort`, a cursor, a to-one by its key, reached by a to-many. A view may read another (`from: () => OtherView`).
- **No options beyond `materialized`.** A view is always in the database and always read by its query: nothing to choose, so nothing to get wrong.
- **No raw-SQL form.** Both queries take SQL where it is wanted: `$where` takes `sql` fragments, and a find selects its source's computed fields, any per-row SQL, a window function included. What only a raw-SQL view adds, a `UNION` or a recursive CTE, stays a read-only entity mapped by hand. A third form would cost a second read path, policies of its own where the others hold their source's, its columns checked against the engine, edges read off refs, and a form MongoDB cannot take.
- **The metadata is one tagged shape**, `view: { kind: 'aggregate' | 'find', from, query, materialized? }`, which every later step reads.

## Reading

- **uql reads a plain view by its query, never by its database object**: `FROM (SELECT ...) AS alias` on SQL, the view's stages ahead of the read's own on MongoDB. Postgres inlines a view into the query reading it anyway, so nothing is lost; MikroORM's virtual entities and Hibernate's `@Subselect` read so.
- **So a plain view is held by its source's policies, in both enforcements, on every engine**: the derived table is the source's query under the caller's context, exactly as `aggregate` is held. Neither enforcement depends on the engine passing rights through a view, and Postgres takes no policy on a view at all.
- **The SQL is the aggregate or the find the dialect already writes.** Read, it binds its values as any query does; installed, it is the same build with values inlined (`compileDdl`'s `inlineValues`), refusing anything left bound. One build, so the view uql reads and the one installed cannot drift.
- **Filters**: the source's default filters are part of the query, soft delete included. A filter reading the context holds a read as on the source, and is left out of the installed SQL, which has no context.
- **Raw SQL reads it as uql does**: `tableOf(refs(WorkspaceUsage))` renders the derived table, held as the read is.
- **One seam per family says where a read takes its rows**: `appendRows` on SQL, a table or the derived table; `rowSource` on MongoDB, a collection and the stages ahead of the read's own. Every read, count, aggregate and join starts there. A lookup into a view matches after its stages with `let` and `$expr`, whose uncorrelated prefix MongoDB caches across the parent's rows. A plain view's composite key stays its columns on MongoDB, since no document of it is stored.
- **What needs rows of its own is refused on a plain view**: a lock; `estimatedCount`, which reads table statistics a query has none of; and `$text` where the engine searches an index of the table (`features.textSearchReadsIndex`: MySQL, MariaDB, SQLite, MongoDB), Postgres searching the columns themselves. A materialized view takes all three. A vector ranking needs no index: on MongoDB a plain view ranks by the computed distance, as a relation's rows do, where `$vectorSearch` would have to lead the pipeline.

## Materialized

- **A materialized view is a table uql owns, on every engine**, created and filled by the migration that creates it. It is a table to every tool, diffed, indexed, introspected and checked for drift as any table is, by the machinery already there. Its columns' types come from the query's result: `aggregate` already reports each column's kind for decoding, mapped to the canonical types the migrator writes.
- **`refreshView` brings it to its query's rows in one `runStatements`**, so a reader sees the old rows or the new ones: a transaction on a server, one batch on D1 and Turso. It is the read's own build, never a second one: on SQL `INSERT INTO <table> (<columns>)` followed by exactly what `appendViewQuery` renders for a read. Keyed, that insert ends in the conflict clause each dialect's upsert already writes (`ON CONFLICT`, `ON DUPLICATE KEY UPDATE`, `MERGE`), and a `DELETE` drops the keys the query no longer yields, which is what `REFRESH ... CONCURRENTLY` does, everywhere; with no key it empties and refills. MongoDB runs the stages `rowSource` reads by into the collection with `$merge` on its key, or `$out` with no key. So the rows a read sees and the rows a refresh stores cannot drift.
- **It holds its own policies, as any table does**, in both enforcements: computed with no context, it cannot hold its source's. One over an entity holding policies or a tenant is refused unless it declares its own, which fail closed.
- **`refreshView` is a querier method**, an `update` in `QUERIER_OPS`, run on the primary and never over the API. When to refresh is the caller's: no schedule. Inside a `transaction()` it joins it, so a refresh lands with the writes that called for it; outside one it runs in its own. It writes rows, never schema, so it is atomic on every engine, MySQL included.
- **Rejected: a native materialized view.** Postgres takes no policy on one, it exists on two engines only, and its `REFRESH ... CONCURRENTLY` is the keyed refresh above, which every engine runs.

## In the database

A plain view is also installed as a view, so an editor, a BI tool or another app reads it by its name. uql never reads it, so it is never what holds a policy: it is the query as the database runs it, created with the reader's rights where the engine has them (`security_invoker` on Postgres, `SQL SECURITY INVOKER` on MySQL and MariaDB), on MongoDB a view collection (`viewOn`, `pipeline`).

- **A view is a node of its own in the schema AST**, not a table's: its name, its schema, its SQL and the tables and views its query reads, read off the query tree (`from`, and each relation its `$group`, `$where` and aggregates reach), never off its SQL text. `createOrder` sorts views with tables by those edges: created after what they read, dropped before. A materialized view's table takes the same edges, so a view over it follows it.
- **The engine normalises both sides, as Atlas does, without a dev database**: the desired SQL is read back as the engine prints it beside the installed view, and the two compare as equals. Where DDL is transactional (Postgres, CockroachDB), the probe is the desired view created under an owned `_uql_` name inside a transaction that reads it back off the catalog (`pg_get_viewdef`) and rolls back: no one else ever sees it, nothing is left behind, and it needs neither `TEMP` nor CockroachDB's temporary views, still behind `experimental_enable_temp_tables`. MySQL and MariaDB commit each DDL statement, so there the probe is created, read off `information_schema.VIEWS` and dropped; one a crash leaves behind is dropped by the next run, by its prefix. SQLite and SQL Server keep a view's text as written (`sqlite_master`, `sys.sql_modules`), and MongoDB its pipeline, so they compare directly.
- **The database is the one source of truth.** A hand-edited view, a restored dump or a branched database is compared as it is, and uql keeps no copy of a definition to drift from it. Rejected: a table of hashes uql owns (TypeORM's `typeorm_metadata`), a second copy of a fact that cannot see a hand edit and, on MySQL's autocommitted DDL, cannot be written with the view; a snapshot file (Drizzle), which does not see the database at all; regexes over the engine's text (MikroORM); and a comment holding a hash, which MySQL views and SQLite cannot carry. Triggers, policies and partial indexes keep their hash in a name uql chooses (`ownedName`), which states it with no probe.
- **A change is a drop and a create, everywhere**, as a trigger's or a policy's is. The only form SQLite has, and past Postgres's `CREATE OR REPLACE VIEW`, which may only append columns. `diffOwned` takes the key it matches by, a trigger's name and a view's name with its normalised text, rather than a second differ beside it.
- **A migration lands whole where the engine takes DDL in a transaction**: dropping its views, altering the tables, recreating the views and filling a materialized table are statements of the one transaction `sync` and each migration already run in (`MigrationSession.transaction`), so Postgres, CockroachDB, SQLite and SQL Server apply all or none. MySQL and MariaDB commit each DDL statement, which no tool can make atomic, so the order keeps every state between them one the next run repairs: views dropped first and created last, so a failure in between leaves them missing, which the next diff sees and creates, since the database is what it compares.
- **A view is taken off and put back around an alter moving a column it reads, or a rebuild of its table**, the rule `cycled` holds a trigger to, dependents first on drop and last on create. Its columns come off its query tree, exactly, where a trigger's come off its SQL by `namesAny`.
- `drift:check` reports a view missing, of the wrong kind, or whose normalised text is not the desired one. Where the role may not create the probe (a read-only one on MySQL), it reports the view as unverified rather than guessing. `generate:from-db` writes a view it finds as a read-only entity, since SQL does not read back into a query.

## Not in this design

- `WITH CHECK OPTION`, updatable views and incremental refresh driven by writes.
- A tenant passed through a grouped tenant column to a materialized view's own policy, until an app needs it.
- `refreshView` over the API, until a client needs it.

## Build order

1. Declaration and types: `defineView` over an aggregate or a find, its key, `readOnly`, sections. Pinned in a `.test-d.ts` beside `readOnlyEntity.test-d.ts`.
2. Reading: the derived table on every SQL dialect and its stages on MongoDB, under the source's filters and policies, and `tableOf`. Held by `querier/view.test.ts` on every SQL engine, `mongodb/mongoView.test.ts`, and `dialect/view.spec.ts`, which pins the SQL under policies.
3. Materialized: the table from the result's kinds, its policies, `refreshView` keyed and not, per engine.
4. In the database: the view node, edges, the normalising probe per engine, drop and create around alters, drift. Held by a shared suite on every engine, on a database of its own.
