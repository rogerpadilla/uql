# Changelog

What changed and worth it, be pretty concise. Newest first, `[yyyy-mm-dd]`.

## [0.41.0] - 2026-09-04

**Enum fields.** The values a column accepts, enforced by the database and by TypeScript:

```ts
@Field({ type: String, enum: ['draft', 'paid', 'void'] as const })
status?: 'draft' | 'paid' | 'void';
```

- Emitted as a column `CHECK (col IN (...))` on every SQL dialect, not a native enum type: adding a value stays an ordinary column change rather than Postgres's irreversible `ALTER TYPE ... ADD VALUE`.
- The property is checked against the values, so a member the column would reject is a compile error. `as const` is what makes them literal; without it you get a `__enumNeedsAsConst` error rather than a silently disabled check.

**Table-level `CHECK` constraints**, emitted with the table:

```ts
@Entity({ checks: [{ expression: raw`"spent" <= "balance"` }] })
```

Unnamed ones are named `ck_<table>_<position>`. A check is created with its table; changing one later is a hand-written migration, since a database reprints SQL text from its parse tree and could only ever be diffed by name.

**Partial-index predicates** and check expressions share one rule: `raw` with no interpolation, since DDL has no placeholder to bind a value into.

## [0.40.0] - 2026-09-04

**`raw` is a tagged template.** Static SQL is the literal, every interpolation is bound:

```ts
raw`"stock" - ${quantity}`
raw`CONCAT(${col('firstName')}, ' ', ${col('lastName')})`
raw`LOG10(${points})`.as('score')
```

- **`raw('sql')` is deprecated**, since it emits verbatim and cannot bind. `npx uql-codemod` rewrites it, moving an alias argument onto the new `.as()`. The callback form is unchanged.
- **New `col(column)`**: the alias-qualified, escaped column of the statement being built. Replaces `${escapedPrefix}.column`, which emitted a double dot.
- **Partial-index predicates take `raw`**: ``@Index(['email'], { where: raw`"deletedAt" IS NULL` })``. A bare string still works; one carrying a value is refused, since `CREATE INDEX` cannot bind.

## [0.39.1] - 2026-09-04

No runtime changes: Linting moved from biome to oxlint and updated readme.

## [0.39.0] - 2026-09-03

**Vector search filters, not just ranks.** `$near` bounds the distance in `$where`, where `$sort` orders by it:

```ts
$where: { embedding: { $near: { $vector: queryVec, $lt: 0.35 } } },
$sort: { embedding: { $vector: queryVec, $project: 'score' } },
$candidates: 200,
```

Bounds are `$lt`/`$lte`/`$gt`/`$gte`/`$between`, at least one; no `$eq`, a distance is a float. Each clause stands alone, so `$near` works in a `count` or `exists`, and you can filter by similarity while ordering by recency.

- **`$candidates` sets ANN recall per query**, in the index's own units: `hnsw.ef_search`/`ivfflat.probes` on Postgres, `mhnsw_ef_search` on MariaDB, `numCandidates` on Atlas. Postgres needs an open transaction - a `SET LOCAL` outside one applies to nothing - and a `$near` over HNSW adds `iterative_scan = strict_order` so the scan fills its limit.
- **`$near` throws on MongoDB**, which scores by index-defined similarity rather than distance. Project the score with `$project` and filter on that.
- **Unsupported metrics throw `TypeError` everywhere**; MariaDB and the SQLite family threw a bare `Error`. Their `vectorDistanceFns` folded into `vectorMetrics`, one map per dialect.
- Entry budgets, nothing newly reachable: root 26.4 KB gzipped (was 25.6), `./postgres` 23.7 KB (was 22.9).

## [0.38.0] - 2026-09-03

**Indexes can go inside a JSON column**, declared the way the query reads them:

```ts
@Index([{ column: 'kind', jsonPath: { path: 'theme.color', type: String } }]) // 'kind.theme.color': 'red'
@Index([{ column: 'kind', jsonPath: { path: 'thema.color', type: String } }]) // error: no such path
@Index([{ column: 'tags', jsonArray: { type: String, length: 64 } }])         // tags: { $all: [...] }
```

Postgres, CockroachDB and SQLite index a path; MySQL only the multi-valued index `$all` needs; MariaDB neither. Each refuses the form it lacks, and `include`'s columns are checked against the entity too.

- **MariaDB's vector index is its own statement**, so `autoSync` adds one to a table that already exists.
- **A MariaDB JSON column reads back as JSON**, not the `LONGTEXT` that reported drift as data loss.
- **MySQL upserts read the inserted row through a row alias**, MariaDB through `VALUE(col)`: `VALUES(col)` is deprecated on both.
- **Drift no longer reports an auto-increment key**, nor a MySQL functional index.
- **Breaking:** the dialects moved to their own entries (`uql-orm/postgres`, `/mysql`, `/maria`, `/sqlite`) and `CREATE INDEX` to `uql-orm/migrate` as `IndexDdl`. Root entry 25.1 KB gzipped, from 28.5 KB.

## [0.37.1] - 2026-09-02

Two `findManyAndCount` fixes, both from the total it now carries in the read's own statement:

- **A `$lock` no longer errors on the Postgres family**, where `FOR UPDATE` and a window function cannot share a statement: a locked page takes its total from a count of its own. MySQL and MariaDB keep the single statement.
- **A `$distinct` total counts the deduplicated rows**, not the rows before deduplication - three rows over two names reported three.

## [0.37.0] - 2026-09-02

**Counting, everywhere it was missing** - a page, a yes or no, a relation's size, a table too big to scan:

```ts
await querier.count(User, { $limit: 1000 }); // capped: "1,000+ matches", no full scan
await querier.exists(User, { $where: { email } }); // stops at the first match
await querier.estimatedCount(User); // the engine's own statistic, no scan

await querier.findMany(User, {
  $count: { posts: true, comments: { $where: { approved: true } } },
  $sort: { posts: { $count: -1 } }, // the users with the most posts
  $limit: 10,
});
// [{ ...user, _count: { posts: 42, comments: 7 } }]
```

- **`$count` costs one grouped statement per relation**, batched over the whole page, so it stays flat however large the page is. Ordering is a correlated tally, so a top-N never loads the rows it ranked by.
- **`findManyAndCount` is one statement on SQL**, down from two: the page carries its own unpaged total, so the two can no longer disagree. That total counts past a `$required` relation now.
- `count` takes `$skip`/`$limit`, settling the matching ids rather than scanning every match, and no longer takes a `$sort` - it never changed the number.
- `estimatedCount` is approximate and whole-table: no filter, so entity filters and soft-deleted rows are inside it, and it is as stale as the last `ANALYZE`. SQLite throws. Server-side only.

Fixes:

- **A client write takes plain data again.** On an entity declaring any method, `client.insertOne(Article, { title: 'Hello' })` was rejected for not handing the method back too.
- **`$limit: 0` reads no rows on MongoDB**, as everywhere else, and a bare `$skip` no longer crashes SQLite.

`RequestSuccessResponse` and `RequestCountedSuccessResponse` moved to `uql-orm/type` from `uql-orm/http`.

## [0.36.1] - 2026-09-01

- README only: the decorators need no compiler flags or `reflect-metadata`, and plain classes work through `defineEntity`.

## [0.36.0] - 2026-09-01

**`expr` defaults resolve per dialect**, so `expr.uuid()` is `gen_random_uuid()` on Postgres and `UUID()` on MySQL from one migration. Where an engine has no equivalent, generation throws instead of emitting DDL it would reject.

- `expr.mysqlUuid()` is gone, `expr.uuid()` covers both. `expr.emptyObject()`/`emptyArray()` too: `defaultValue: {}` and `[]` emit the same SQL.
- **New `expr.uuidv7()`** for time-ordered keys: `uuidv7()` on Postgres 18+, `UUID_v7()` on MariaDB 11.7+.

## [0.35.0] - 2026-09-01

- **The migration expression helper is renamed to `expr` from `t`**, which frees `t` for the table callback: `createTable('articles', (t) => t.timestamp('at', { defaultValue: expr.now() }))`.
- `expr.literal()`, `expr.number()` and `expr.null()` are gone: `defaultValue` already formats strings, numbers and `null` into the same SQL. Pass the value.
- `expr.true()` and `expr.false()` are gone as well.
- `expr.uuid()`, `expr.emptyObject()` and `expr.emptyArray()` are documented as Postgres-only, which is what they always were - `DEFAULT gen_random_uuid()` is invalid on MySQL. Use `expr.mysqlUuid()` there.

## [0.34.1] - 2026-08-31

**Migrations understand `schema` now.** In 0.34.0 only queries did, so `migration:generate`, `drift:check` and `autoSync` still treated every table as unqualified. They now write and read one the way a query does.

`SchemaGenerator` gained `resolveTableAlias` and `resolveSchema`, and a `TableNode` carries its `schema` beside an unqualified `name`. Both only matter if you implement one yourself.

## [0.34.0] - 2026-08-31

**An entity can name the schema it lives in**, and a pool can set a default for the rest:

```ts
@Entity({ schema: 'crm' }) class Customer {}
@Entity({ schema: 'sales' }) class Order {} // joins Customer in one statement

new PgQuerierPool({ connectionString }, { schema: 'tenant_a' }); // a schema per tenant
```

The entity's `schema` takes priority over the pool's; with neither, nothing changes. SQLite and MongoDB ignore schema. Migrations create each schema, but the diff still matches on unqualified names, so a qualified entity always looks new to `drift:check` and `autoSync`.

- A dotted `name` now throws and points at `schema` attribute.
- The HTTP middleware refuses to start when two entities claim the same route.

## [0.33.0] - 2026-08-30

**The HTTP handler takes its pool as an option**, and a function picks one per request, so one deployment can serve a database per tenant:

```ts
createFetchHandler({ pool, include: [User] });
createFetchHandler({
  include: [User],
  pool: (_request, { tenantId }) => poolFor(tenantId),
});
```

`setQuerierPool`, `getQuerierPool` and `getQuerier` are gone with it: pass the pool where it is used, and `pool.withQuerier(...)` / `pool.transaction(...)` where you need a querier. `npx uql-codemod` points at every call site.

## [0.32.1] - 2026-08-30

- **A populated to-many comes back as a list**, empty where the parent has no children, so it maps and counts without a guard and its type no longer needs `!`.

## [0.32.0] - 2026-08-30

**Find results are narrowed to what the query projected.** `$select` and `$exclude` shape the row type:

```ts
const user = await querier.findOne(User, { $select: { name: true } });
user.name; // string
user.email; // compile error: not selected
```

Breaking only in that sense: code reading an unprojected field stops compiling. Add the field to the projection, or drop the projection entirely.

## [0.31.5] - 2026-08-30

- **MongoDB orders by a relation you did not populate**, as the SQL dialects always have. It used to refuse.
- MongoDB throws on a `$vector` sort under a relation, and `findManyStream` refuses a relation `$sort`, instead of returning rows in no order. Use `findMany`.
- Over HTTP, `$limit=0`/`$skip=0` are honored and `$distinct` is accepted.
- **Type-checking is about a quarter cheaper**: `$where` and `Query` are no longer intersections.
- `AbstractSqlDialect.appendInsertValues` dropped an unused parameter, which a subclass overriding it must match.

## [0.31.4] - 2026-08-28

- **MongoDB honors `$distinct`**, and `$sort`/`$limit`/`$skip` on `updateMany`/`deleteMany`. Both were dropped, so `deleteMany(User, { $where, $limit: 1 })` removed every match.
- Cascading a relation across many rows costs two statements, not two per matched row.

## [0.31.3] - 2026-08-27

- A vector `$sort` works on `updateMany`/`deleteMany` (SQL), so "update the 10 rows closest to this vector" compiles. Still rejected on a populated relation.
- Type-checking a project that uses UQL is about twice as fast.

## [0.31.2] - 2026-08-27

- **`Json<T>[]` is a field, not a relation.** An array of JSON documents can be declared under `defineEntity({ fields })`, and `lines?: Json<{ sku: string }>[]` gives a typed `'lines.sku'` path in `$where` and `$sort`.

## [0.31.0] - 2026-08-23

- **PGlite: Postgres in-process, no server.** `uql-orm/pglite` runs the Postgres dialect against WASM Postgres - JSONB, full-text, `RETURNING`, upsert `created` and pgvector all behave as on a server.

  ```ts
  const pool = new PgliteQuerierPool(); // in memory; 'file://./pgdata' to persist
  ```

  Vector columns need the extension passed in: `new PgliteQuerierPool('memory://', { extensions: { vector } })`.

- A pool sharing one connection opens it once when acquisitions race. Local SQLite, embedded Turso and PGlite opened one per caller and leaked all but the last - separate databases, in memory.
- `$populate` checks a relation's own `$select`/`$exclude`/`$sort` against its fields; a typo there used to compile.
- `readonly` relations and arrays behave like their mutable form.

## [0.30.0] - 2026-08-20

### Breaking

- `count()` takes a filter only: its `$skip` became an `OFFSET` that pushed the one result row away.
- `$limit: 0` returns zero rows, not the whole table. Negative, fractional and `NaN` pages throw.
- `$sum`/`$avg`/`$min`/`$max` are `| null` and take numeric columns only; `$count` stays `number`.
- An aggregate's `$having`/`$sort` may only name a column it emits, and an `$agg` alias may not repeat a `$group` column.
- Vector `$sort` is rejected on `updateMany`/`deleteMany`/`aggregate`.

### Fixes

- `@BeforeDelete`/`@AfterDelete` run at all - they were emitted with an empty payload - and now receive the rows being deleted.
- A nullish id throws instead of addressing every row: `deleteOneById(User, undefined)` emptied the table.
- `$where: { at: someDate }` filters instead of dropping the condition; same for `Uint8Array` and in `$having`.
- An entity with a lifecycle hook can be written again, methods are no longer populatable relations, and query errors name the actual mistake.

## [0.29.0] - 2026-08-20

### Breaking

- **`@Transactional()` and `currentQuerier()` are gone.** Wrap the body in `pool.transaction(async (querier) => ...)`. `uql-codemod` reports both rather than rewriting them: it cannot know which pool.

### Fixes

- Releasing a querier with a transaction open rolls it back instead of throwing.
- Using a querier after releasing it throws instead of quietly taking a second connection nothing would return.
- A connection whose rollback failed is discarded rather than returned to the pool.
- `rollbackTransaction()` is a no-op when no transaction is open, so it is safe from a `catch`.

## [0.28.1] - 2026-08-16

- MongoDB rejected every query that filtered, ordered and populated at once (`a pipeline stage specification object must contain exactly one field`), and dropped a nested `$populate`.
- A vector search with `$project` and no `$select` returned only the score, not the document.
- MongoDB orders by a nested relation path (`$sort: { tax: { category: { name: 1 } } }`) when every level is populated.

## [0.28.0] - 2026-08-16

### Fixes

- **A group nested in `$and`/`$or`/`$not` lost its parentheses**, so `{ $and: [{ companyId: 1 }, { $or: [a, b] }] }` ran as `(companyId = 1 AND a) OR b` and returned wrong rows silently. `$not` negated only its first term. `security: true` filters were never affected.
- **`$i*` operators lowered the pattern but not the column** on MySQL, MariaDB and SQLite, so `$istartsWith: 'Some'` matched neither `Some` nor `SOME` under a case-sensitive collation.
- `$sort` by a relation named a table that was never joined, and mis-addressed nested paths and `@Field({ name })` columns.

### Breaking

- Ordering by a related field no longer needs `$populate` - the join is made for the sort, carrying the relation's filters. MongoDB still requires it populated.
- `$sort` on a to-many is rejected (sort inside `$populate` instead), as is a relation `$sort` where nothing can join it: `updateMany`, `deleteMany`, `$group`, and `$distinct` unless populated.
- `$sort`/`$limit`/`$skip`/`$distinct` inside a to-one `$populate` are rejected rather than silently dropped.
- `$i*` on MySQL and MariaDB emits `LOWER(column)`, which only a `LOWER(column)` expression index can serve.

## [0.27.0] - 2026-08-15

- **`$lock`: row-level locking on reads.** `$lock: true` emits `SELECT ... FOR UPDATE`; `{ wait: 'skip' | 'nowait' }` adds `SKIP LOCKED`/`NOWAIT`, which is what makes a work queue on the database possible. Needs an open transaction. PostgreSQL, CockroachDB, MySQL, MariaDB.

## [0.26.2] - 2026-08-10

- `deleteMany` spent two statements on one row. Only a cascade or a paged delete resolves ids first now.

## [0.26.0] - 2026-08-09

UQL could create every kind of index but not read most of them back, so `drift:check` called healthy schemas broken and `sync` never added an index to an existing table.

- `sync` creates an index added to an existing entity; `drift:check` reports one that no longer matches; `generate:from-db` writes expression, partial and covering indexes.
- **Breaking:** `IndexSchema.columns` is now `entries` (an entry need not be a column - `raw('lower(email)')` is one); `DriftDetector`/`createDriftDetector` are replaced by `detectDrift()`; `SchemaIntrospector` requires an `indexFacets` set; a naming strategy no longer renames anything named explicitly.
- An expression index introspected as having no columns, `@Field({ unique })` reported as an unexpected index on Postgres, and every primary key reported as a nullable mismatch.

## [0.25.1] - 2026-08-08

- `FieldOptions` accepts `onDelete` directly, so a bare `@Field({ references, onDelete })` cascades without inventing a `@ManyToOne` to carry it.

## [0.25.0] - 2026-08-08

Foreign keys: UQL declared them but did not reliably create or enforce them.

- **`onDelete`/`onUpdate` per relation**, so the database cascades in one statement where `cascade: 'delete'` walks the graph in JS.
- `sync`, `sync --dry-run` and `generate:entities` left out most foreign keys - 38 constraints became 1 on the test schema. All three emit tables first, constraints after, which is also the only way a cyclic graph can be created.
- Cascade delete removed the parent before its children, failing against any schema with real constraints.
- **`bun:sqlite` and Turso did not enforce foreign keys** (SQLite leaves it off per connection and those drivers do not switch it on). `PRAGMA foreign_keys = ON` is set on connect now, so existing databases holding violating rows will start reporting them.
- **Breaking:** `generateCreateTable` is gone - a single-entity AST cannot resolve a relation, so it dropped those foreign keys. Use `generateCreateSchema(entities, { only })`.

## [0.24.7] - 2026-08-07

- **A read returned whatever the driver returned, not the type the field declares.** A `vector` arrived as pgvector's text, `type: Boolean` as `1`, `type: Number` as `'9'` from node-postgres - auto-increment ids included. Reads, streams and `aggregate()` decode by the entity's declaration now.
- `aggregate()` returned `$sum` as a string; `$count`/`$sum`/`$avg` are numbers and `$min`/`$max` the field's own type.
- `$having` threw on operators its own type accepts; it shares the `WHERE` renderer now, which also makes `$having: { alias: { $eq: null } }` emit `IS NULL`.

## [0.24.6] - 2026-08-05

- `$exclude` could subtract the keys a relation is assembled from, leaving `$populate` unfilled.
- MongoDB ignored `$select`/`$exclude` whenever a relation was populated or filtered on, returning every column.
- A many-to-many `$populate` sent the target's relation query to the join table.

## [0.24.3] - 2026-08-03

- `@Field({ references })` with no `type` left the property unchecked, so a `string` foreign key to a numeric primary key compiled.
- `onInsert`/`onUpdate`/`defaultValue`/`softDelete` produce what the field declares, so `@Id({ type: 'uuid', onInsert: () => 42 })` no longer compiles.

## [0.24.2] - 2026-08-03

- **Field names went unchecked in any project without `@types/node`.** `Scalar` named `Buffer`, an ambient Node global, so in a browser or edge project it collapsed `Scalar` and then `FieldKey` to `any`: `$select`, `$where`, `$sort`, `@Index` and `mappedBy` took any string at all, silently. `Scalar` says `Uint8Array` now.
- A to-many with no `mappedBy`/`through`/`references`, or a `mappedBy` naming nothing on the target, failed mid-query against columns nobody has. The first is a compile error, both throw when the entity resolves.
- `@OneToMany({ entity, through })` derived a foreign key on the owner - a spurious column in its DDL - instead of the junction's pair.
- A `@Field({ references })` column now always gets its many-to-one, so a junction written as two plain columns behaves the same in every graph.

## [0.24.1] - 2026-08-02

- `mappedBy` callbacks no longer need a `!`, and `@ManyToMany({ through })` compiles for a target with no relations of its own. A pivot missing a derived join column throws when the entity resolves.

## [0.24.0] - 2026-08-02

- **The pool runs every operation.** `QuerierPool` implements the whole `UniversalQuerier`, so a helper can take "a querier, or the pool" and the caller decides whether it is atomic:

  ```ts
  async function markPaid(db: UniversalQuerier, id: string) {
    await db.updateOneById(Invoice, id, { status: "paid" });
  }

  await markPaid(pool, id); // its own unit of work
  await pool.transaction((querier) => markPaid(querier, id)); // one step of a larger one
  ```

- Streaming as the first operation on a freshly acquired querier threw `pool querier not connected` on every pooled driver.

## [0.23.0] - 2026-08-01

### Breaking: decorators are the standard TC39 ones

No `experimentalDecorators`, no `emitDecoratorMetadata`, no `reflect-metadata`. A codemod does most of the migration: `npx uql-codemod --project=tsconfig.json --dry-run`. See the [upgrade guide](https://uql-orm.dev/upgrade-guide).

- **`type` is required on every `@Field`/`@Id`** and `entity` on every relation, since nothing reflects any more. In exchange the annotation is checked against the property: `@Field({ type: String })` on a `number` is a compile error instead of a wrong column.
- `@InjectQuerier()` and `Relation<T>` are gone; `@Log()` and `@Serialized()` with them.
- `target` must not be `esnext`, the one target where TypeScript emits decorator syntax untransformed.
- NestJS projects must use `defineEntity`: Nest's DI needs parameter decorators, and one `tsconfig.json` cannot mix specs.
- `uql.config.ts` needs a runtime that transforms TypeScript (`bun`, or `node --import tsx`). The `jiti` peer is gone.
- **Node 24 is the minimum** (`>=20` is end of life).

### Also

- **`NodeSqliteQuerierPool`** runs on `node:sqlite`, so SQLite needs no native build. `better-sqlite3` stays supported and faster for read-heavy work.
- **`await using querier = await pool.getQuerier()`** releases on scope exit, so an early return or a throw cannot leak a connection.
- `querier.transaction()` no longer releases the connection, as the docs always said. It released early inside `pool.withQuerier()`, so anything after the transactional section ran on a connection already back in the pool.

## [0.22.0] - 2026-07-31

- **Vector search verified on every engine that has it** - pgvector, CockroachDB, MariaDB, MySQL, sqlite-vec, libSQL, Turso. It had only ever been exercised on Postgres.
- **Index entries take expressions, prefix lengths, order, `INCLUDE` and operator classes**: `@Index([raw('lower("email")')], { unique: true })`. What an engine cannot express is refused when the migration is generated.
- **Turso**: `uql-orm/turso` (Cloud over `fetch`, edge-safe) and `uql-orm/turso/local` (embedded, native streaming).
- `uql sync` printed a plan and applied nothing unless `--force`; `--dry-run` prints statements, `--unsafe` allows drops.
- `addColumn`/`alterColumn` created a `VARCHAR` whatever the migration declared; partial indexes were widened to the whole table; inverse one-to-one emitted a reversed foreign key; SQLite under Bun lost every inserted id.
- **Breaking:** `addColumn(table, cb)`/`alterColumn(table, cb)` take a callback declaring the column; `IndexDecoratorOptions` is `IndexOptions`; `namingStrategy` is gone from `MigratorOptions` (set it on the pool).

## [0.21.0] - 2026-07-30

- **Breaking: `reflect-metadata` and `jiti` are optional peers.** Both were mandatory for one use each - 264 KB and 1.8 MB. `@Field()` with no explicit `type` needs `reflect-metadata` installed and imported once; `uql-migrate` with a TypeScript config needs `jiti`. `uql-orm/migrate` dropped from ~99 KB to 35 KB gzip.
- **Relation filtering and `$size` on MongoDB**: `$where: { comments: { text: 'hi' } }` compiles to one correlated `$lookup` per condition, so the same query runs on every driver.
- **Relation subqueries applied none of the target's filters, bypassing `security: true`.** A client-supplied `$size` could count rows it cannot read, and a relation filter matched parents through soft-deleted children.
- MongoDB addressed property names where the document stores something else: `$select` returned a renamed field as `undefined`, `$sort` did not order, and `deleteOneById` reported success while leaving the document visible.
- MySQL/MariaDB inline literals no longer go through `sqlstring`, which emitted `` `0` = 255 `` for a `Uint8Array` and `'[object Object]'` for a plain object.

## [0.20.1] - 2026-07-27

- A `security: true` filter on a joined relation was skipped by a `$populate` with no explicit `$where` on it, on every driver.
- PostgreSQL/CockroachDB: `$size` misbound its value when it was not the first condition, and upserts bound the wrong value to the 2nd+ auto-filled `onUpdate` column.

## [0.20.0] - 2026-07-26

- **Breaking: `$merge` is `$set`.** The operator is a shallow key assignment, not an RFC 7396 merge patch, and now matches MongoDB's own vocabulary. `JsonPushFields` is `JsonArrayFields`.
- **`$pull`** removes every element equal to a value, on every SQL dialect and MongoDB. Operators apply in a fixed order - `$pull` → `$set` → `$push` → `$unset` - so `$pull` and `$push` on one key atomically replace an element.
- **Breaking: `$push` onto a missing key creates the array everywhere.** MariaDB's `JSON_ARRAY_APPEND` returned `NULL` for a missing path and **wrote that `NULL` back, destroying the document**; MySQL silently no-opped.
- **Breaking: MongoDB JSON operators map onto MongoDB's own.** They used to be written into the document as literal data - `{ kind: { $push: { tags: 'x' } } }` stored the operator object itself.
- **Breaking: vector indexes must declare `distance`.** Omitting it silently changed the DDL: MariaDB defaults to euclidean, so a cosine query full-scanned.
- JSON dot-paths and `$elemMatch` now behave the same on all 8 drivers - MySQL's `->>` needed a full `'$.path'`, MariaDB's `$size` needed `JSON_EXTRACT`, and a JSON scalar now compares in the representation every engine agrees on.
- `$includes` was case-insensitive on PostgreSQL and CockroachDB, rendering as `ILIKE` because the operator name starts with `$i`.
- PostgreSQL `$text` uses `websearch_to_tsquery`, which no longer raises `syntax error in tsquery` on a plain two-word search.

## [0.19.0] - 2026-07-24

- **Breaking: operators are typed per field.** String ops on strings, ordering ops on comparable types, array ops on arrays - `{ age: { $like: '3%' } }` is a compile error now.
- **Breaking: JSON dot-paths are restricted to real `Json<T>` fields** and resolve each path's value type, so a typo'd path is a compile error. `Json<unknown>` stays permissive.
- Raw `$select` projections for computed columns: `$select: [raw('*'), raw('LOG10("votes" + 1)', 'hotness')]`.

## [0.18.0] - 2026-07-23

- `$countDistinct`/`$sumDistinct`/`$avgDistinct`, identical on every SQL dialect and MongoDB.
- `$count: 'field'` counts non-null values on MongoDB, matching SQL.
- `'*'` is accepted only by `$count`, and each `$agg` entry must hold exactly one operation.

## [0.17.1] - 2026-07-20

- **Breaking: simpler logging options.** `slowQuery: { threshold: 200 }` is `slowQuery: 200`; `logParams` is `logValues`, top-level, and applies to regular query logging too.
- **`logValues` defaults to `false`**, since bound values may hold PII.
- `findManyStream` and transaction statements carry the failing SQL on `.query` like every other method.

## [0.17.0] - 2026-07-19

- **Breaking: typo'd query keys are compile errors.** A bad key in `$select`/`$where`/`$populate`/`$sort` used to slip through when it sat next to a valid one.
- **Breaking: find results are the plain entity.** Annotate with `WithDistance<Article, 'distance'>` when you `$project` a vector score.
- **The SQLite family uses `RETURNING`**, so `insertMany`/`upsertOne`/`upsertMany` return exact ids there instead of guessed rowids or nothing.
- MySQL `upsertMany` could return ids that were never real rows: a mixed batch reports `changes` as a weighted sum, which the old code read as a row count.

## [0.16.0] - 2026-07-19

- **Breaking: `$group` and `$agg` are separate.** `$group` lists columns to group by, `$agg` holds the functions, and `$having`/`$sort` may only name what the query emits:

  ```ts
  $group: { status: true }, $agg: { count: { $count: '*' } }
  ```

## [0.15.2] - 2026-07-10

- `insertOne`/`insertMany` return the right ids on every database, and `undefined` rather than a made-up one where the driver reports none.
- A batch may mix records with different columns (the union is inserted, each gap taking the column default), and a batch past the driver's bind limit splits automatically with ids still in input order.
- MariaDB uses native `INSERT ... RETURNING`; clustered MySQL's `auto_increment_increment` stride is detected instead of assumed to be 1.

## [0.15.0] - 2026-07-09

- **Read helpers on the pool.** `pool.findMany`/`findOne`/`count`/`aggregate` each acquire a connection, run one operation and release it, so `Promise.all` fans out across connections. `pool.withQuerier` remains the tool for a unit of work.
- **Breaking:** pool base-class generics are querier-first (`AbstractQuerierPool<Q, D>`), matching the interface they implement.
- `Sqlite3QuerierPool` hands out a querier per acquisition, so a pool read inside `pool.transaction(...)` no longer rolls back the outer transaction.

## [0.14.1] - 2026-07-09

- **`captureContext()`** carries the ambient context across event boundaries - `AsyncLocalStorage` does not propagate into emitter callbacks, timers or queued work.
- **`pool.withQuerier(cb, { context })`** scopes one unit of work, where `withContext` scopes a span.
- A security filter's condition may return `{}` to mean "resolved, no restriction", so a maintenance job can span tenants deliberately. A missing context still fails closed.

## [0.14.0] - 2026-07-08

- **Query filters**: a named condition attached to an entity, applied to every query until you turn it off.

  ```ts
  @Filter('active', { condition: { status: 'active' }, default: false })
  querier.findMany(Task, {}, { filters: { active: true } });
  ```

- **Multi-tenancy / row-level security**: mark a filter `security` and resolve it from a per-request context. It applies to relations and cascades, cannot be turned off, and a client cannot widen it with their own `$where`. With no tenant in context the query throws rather than running unscoped.
- **`restoreOneById`/`restoreMany`**, and `withDeleted()` to include trashed rows in any read.
- **Breaking: permanent deletes use `hardDelete`** (was `{ softDelete: false }`); over HTTP, `DELETE ?hardDelete=true`.

## [0.12.0] - 2026-07-06

- **Breaking: `softDelete` moves from `@Entity` to `@Field`.** `@Field({ softDelete: true })` marks the property itself, so the reference cannot be typo'd, and the marker carries the value stamped on delete (`true` for `new Date()`, or a callback).

## [0.11.0] - 2026-07-06

- Foreign-key columns are created from relations: an owning `@ManyToOne` with no explicit `@Field({ references })` generates the `<relation>Id` column, inheriting the referenced key's type instead of defaulting to an integer.
- **Breaking:** `softDelete` is configured by field name; `onDelete` and `foreignKey` are gone from `FieldOptions`.

## [0.10.1] - 2026-07-03

- **`uql-orm@0.10.0` shipped only the browser bundle** - every server-side import failed. `prepack` now verifies every path declared in `main`, `types`, `bin` and `exports` before packing. Use 0.10.1.
- `UqlModule` ends the pool on application shutdown.

## [0.10.0] - 2026-07-02

- **`uql-orm/http`**: one framework-agnostic wire contract. `createFetchHandler` mounts on Hono, Next.js, Bun.serve, Deno.serve, Cloudflare Workers and SvelteKit; `createRequestHandler` bridges anything else. `uql-orm/express` is a thin adapter over it.
- **`uql-orm/nestjs`**: `UqlModule.forRoot({ pool })`.
- Reads can send the query in the body via the HTTP QUERY method (RFC 10008), avoiding URL-length limits.
- **Breaking:** hooks receive one `HookContext` instead of `(req, meta)` and abort by throwing; error responses are `{ error: { message, code } }`; `buildQuerierRouter` and express `parseQuery` are gone; `uql-orm/browser` no longer loads `reflect-metadata`.

## [0.9.4] - 2026-06-29

- The `$entity` dual API is restored with overloads, so both `(Entity, query)` and `({ $entity, ...query })` infer correctly.

## [0.9.2] - 2026-06-10

- Express's lazy `req.query` getter re-parsed the URL on every access, silently discarding the middleware's coercion of `$limit`/`$skip` and its JSON parse of `$where`.

## [0.8.4] - 2026-04-11

- **`$populate` for relations and `$exclude` for subtractive projection.** Relations in `$select` are deprecated (warned once per key) and unsupported.
- `findManyStream` rejects unsupported relation loading up front: MongoDB for any relation, SQL for to-many ones.

## [0.8.2] - 2026-04-04

- **Generated migrations were invalid TypeScript with LibSQL** ([#86](https://github.com/rogerpadilla/uql/issues/86)): SQLite identifier backticks terminated the template literal the SQL was embedded in. Each `querier.run(...)` argument is `JSON.stringify`d now.
- **sqld rejects multiple statements in one `execute`** ([#87](https://github.com/rogerpadilla/uql/issues/87)), so entity-generated migrations emit one `run` per statement.
- **Breaking:** the `generateCreateTable*` methods return `string[]`, one entry per statement.

## [0.8.0] - 2026-04-03

- **Decorator-free entities**: `defineEntity` takes bulk `fields`, `relations`, `indexes` and `hooks`; `defineField`, `defineId` and `defineRelation` are exported for imperative registration.
- **Breaking (internal):** the metadata registry key is `Symbol.for('uql-orm/entity/metadata')`, and `getOrCreateMeta` is `ensureMeta`.

## [0.7.10] - 2026-04-02

- JSON/JSONB columns returned as text by some drivers (SQLite, some Bun SQL stacks) are parsed back into objects, in reads, streams and loaded relations.

## [0.7.9] - 2026-03-31

- **Breaking:** `MongoDialect` is no longer re-exported from `uql-orm` or `uql-orm/dialect` (it pulled the Mongo graph into SQL-only apps) - import from `uql-orm/mongo`. `createSchemaGenerator` is SQL-only; MongoDB uses `createSchemaGeneratorAsync`.

## [0.7.7] - 2026-03-31

- **Breaking (internal):** `QuerierPool` exposes `dialect` (was `dialectInstance`), the engine id is `dialect.dialectName`, and `dialect` is gone from `Config`/`MigratorOptions`. `dialectConfig`/`DialectConfig` are replaced by `DialectOptions` and per-driver dialect classes.

## [0.7.0] - 2026-03-19

- **Bun SQL support** (`uql-orm/bunSql`): one `BunSqlQuerierPool` infers the dialect from `SQL.Options` and routes to the Postgres, MySQL, MariaDB, SQLite or CockroachDB builder.
- **Breaking: `$ne` is null-safe everywhere.** Rows with `NULL` in the compared column are included when they differ from the bound value (`IS DISTINCT FROM`, `IS NOT`, `NOT (col <=> ?)`), matching what every other ORM does. Queries relying on SQL's three-valued logic may return more rows.

## [0.6.0] - 2026-03-18

- `$push` appends to a JSON array atomically, and `JsonUpdateOp` types `$merge`/`$unset`/`$push` for `Json<T>` fields.
- MariaDB extracted JSON paths with MySQL-style `->`/`->>`, which it does not support; it uses `JSON_VALUE(...)` now.

## [0.5.0] - 2026-03-15

- **CockroachDB support**: its own dialect and querier, with native upsert.

## [0.4.0] - 2026-03-13

- **`findManyStream()`**: cursor-based `for await...of` over large result sets, on each driver's own streaming API (`better-sqlite3` `.iterate()`, MongoDB cursors, MariaDB `queryStream()`, `pg-query-stream`, MySQL2 streams). No relation-filling and no hooks.
- **Breaking:** the deprecated `reference` field option is gone; use `references`.

## [0.3.1] - 2026-03-12

- **MongoDB Atlas vector search** via `$vectorSearch`, behind the same `$sort` API, with `$where` pushed down as a pre-filter.

## [0.3.0] - 2026-03-12

- **Semantic search**: vector similarity through `$sort`, on pgvector, MariaDB and SQLite, with five distance metrics and a projected score.

  ```ts
  await querier.findMany(Article, {
    $sort: { embedding: { $vector: queryVec, $distance: "cosine" } },
    $limit: 10,
  });
  ```

- **Vector columns and indexes**: `@Field({ type: 'vector', dimensions: 1536 })` plus Postgres `halfvec`/`sparsevec`, and HNSW/IVFFlat via `@Index`. `CREATE EXTENSION IF NOT EXISTS vector` is emitted where needed.

## [0.2.7] - 2026-03-11

- `$size` takes comparison operators (`{ $size: { $gte: 2 } }`), and on a to-many relation it becomes a `COUNT(*)` subquery.

## [0.2.2] - 2026-03-09

- **`querier.aggregate()`** across every SQL dialect and MongoDB: `$group`, `$having`, `$where`, `$sort`, `$skip`, `$limit`, and `$distinct` on `Query<E>`.
- `$sort: { field: -1 }` sorted ascending: the direction map only had the string `'-1'`.

## [0.2.0] - 2026-03-08

- **Transaction isolation levels** on `beginTransaction()`/`transaction()`, inline on PostgreSQL, `SET TRANSACTION` on MySQL/MariaDB, ignored where the engine has none.
- `@Transactional({ isolationLevel })`, and a nested `transaction()` reuses the active one instead of failing.

## [0.1.1] - 2026-03-08

- Columns containing underscores (`user_id`) were unflattened into nested objects. JOIN aliases use quoted dot-notation now.

## [0.1.0] - 2026-03-08

**Renamed `@uql/core` to `uql-orm`**, published unscoped, and reset to `0.1.0`. A rename, not a rewrite: everything from `@uql/core@3.15.0` is preserved. Update imports (`uql-orm`, `uql-orm/postgres`, `uql-orm/migrate`). New home: [uql-orm.dev](https://uql-orm.dev).

---

Releases before the rename were published as `@uql/core` (`3.15.0` and earlier, 2023-2026). Their notes are in this file's git history; the features they introduced - lifecycle hooks, the schema AST and drift detection, JSON dot-path querying, relation filtering, `upsertMany`, `withQuerier`, the query operator set - are all documented at [uql-orm.dev](https://uql-orm.dev).
