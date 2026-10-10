# Changelog

Newest first, `[yyyy-mm-dd]`. One short line per change: what changed for users, not how or why. `**Breaking:**` marks only a change most users must act on, or one that silently changes what a query reads or writes; a rename or tightening the compiler reports is a plain line. No internals, sizes or tests.

## [0.101.1] - 2026-10-10

- `uql-orm/migrate`, `uql-orm/http` and the driver entries export only what the docs use: the CLI helpers, DDL classes, drift detection and the dialects' feature tables are no longer exported.
- **Fixed:** an upsert of a composite-key row, found by another unique column, reports the key it has in the database.

## [0.101.0] - 2026-10-09

- Runs on Node 22.18 and newer, not only 24.
- Saving a relation works with a composite key on the parent, the target or both.

## [0.100.3] - 2026-10-09

- Reads and writes are faster and allocate less, on every engine.
- Deno is no longer officially supported: its team joined Cloudflare, and the runtime gets fixes for one more year only.
- Fixed: on the Postgres family, a raw query's `timestamp[]` and `date[]` read in the process's zone, `numeric[]` as rounded floats, and `int8[]` elements as a `BIGINT` does.

## [0.100.2] - 2026-10-09

- `uql-codemod` rewrites `run(sql, [values])` and `all(sql, [values])` with `?` or `$n` placeholders into tags.

## [0.100.1] - 2026-10-08

- Fixed: the migration CLI on Node with tsx shares the config's `uql-orm` instead of loading a second copy.

## [0.100.0] - 2026-10-08

- **Breaking:** entries renamed to `uql-orm/mariadb`, `uql-orm/mongodb` and `uql-orm/bun-sql`; `uql-orm/type`, `/dialect`, `/entity`, `/querier` and `/namingStrategy` are gone, import from `uql-orm`. [`uql-codemod`](https://uql-orm.dev/codemod) rewrites the imports.
- **Breaking:** raw SQL is a tag, ``pool.all`SELECT ... WHERE id = ${id}` ``, binding each value; `all` and `run` no longer take a plain string. `raw.join` composes fragments, `raw.text(sql)` runs trusted text.
- **Breaking:** `transaction()` inside another is a savepoint, and a pool call inside a transaction callback joins it.
- **Breaking:** a to-many update keeps the children the payload lists and removes the rest.
- **Breaking:** `upsertOne`/`upsertMany` resolve to ids, like inserts.
- **Breaking:** a `decimal` reads and writes as exact text (`string`) on every engine; `type: Number` opts in to a number.
- Renamed: `Sqlite3QuerierPool` is `SqliteQuerierPool`, the migration builder's types drop their `I` prefix, `/http`'s `HookContext` and `Hook` are `RequestHookContext` and `RequestHook`.
- Every write takes `{ returning: { ...fields } }` and resolves to those rows.
- `querier.onCommit(fn)` runs after the outermost commit.
- An untyped JSON column is a bare `Json`; `Json<unknown>` no longer compiles.
- An `undefined` in `$where` or `$having` throws instead of matching everything.
- `generate:entities` renames a column in place only when the names differ by case or underscores; it suggests other renames.
- MongoDB enforces checks and enums through a collection validator.
- A sync creating tables is several times faster on MySQL, MariaDB and CockroachDB.
- Fixed: concurrent transactions on SQLite, PGlite and local Turso; a cascade delete through a to-one deleting an unrelated row; MongoDB upserts dropping `onInsert` fields; `uql-orm/mssql` on Node; `/http` answers 400 to a malformed body.

## [0.99.0] - 2026-10-07

- A migration file that fails to load stops `up` and `down` before anything runs, instead of being skipped.

## [0.98.0] - 2026-10-07

- **Breaking:** `$regex` is case-sensitive on MySQL and MariaDB, as on every other engine.
- `$regex` runs on SQLite through `better-sqlite3` and `node:sqlite`.
- Fixed: `generate:from-db` and `drift:check` read partial indexes on SQLite and SQL Server and report fewer false drifts; changing a table's key works on CockroachDB.

## [0.97.0] - 2026-10-07

- Editing a check or an enum's values replaces it in the next migration or `sync`. Checks installed before are warned about: drop them by hand.
- `drift:check` reports a missing or stale check or trigger.

## [0.96.1] - 2026-10-06

- A long `$or` or `$and` nests shallower.

## [0.96.0] - 2026-10-06

- A foreign key covered only by a partial, fulltext, vector or prefix index gets its own index.
- `drift:check` on MongoDB refuses instead of always reporting drift.
- Fixed: a forced `sync` over a cycle of foreign keys on MySQL, MariaDB and SQL Server; a dropped Postgres connection crashing the process; a migration's `transaction: false`.

## [0.95.1] - 2026-10-01

- Fixed: a write split to fit the engine runs in one transaction; large mixed `insertMany` on D1 and SQL Server; leaving a `findManyStream` loop early on MariaDB; an upsert matching on a null conflict key.

## [0.95.0] - 2026-10-01

- **Breaking:** an upsert takes its update as the fourth argument instead of `{ update }`. `uql-codemod` rewrites it.
- Fixed: upserts and saves with a key write cascaded relations; boolean defaults no longer report drift.

## [0.94.0] - 2026-10-01

- A statement on a querier inside its own `findManyStream` loop throws instead of hanging. Streams run `@AfterLoad`.
- A statement binding more values than its engine allows throws `UqlUsageError`: split a long `$in`.
- Fixed: large batch writes and cascades on SQL Server, PGlite, MySQL, MariaDB and D1; JSON list defaults.

## [0.93.1] - 2026-10-01

- `$inc` and `$mul` step by another field: `{ total: { $inc: newRow.amount } }`.
- A generated migration alters a table's columns in one statement.

## [0.93.0] - 2026-10-01

- **Breaking:** the migration builder's `expr` is gone: use `currentTimestamp` and `raw` from `uql-orm`. `uql-codemod` rewrites them.
- New database defaults: `currentDate`, `currentTime`, `uuid` and `uuidv7`.
- Upserts take an update for a conflicting row: `{ uses: { $inc: 1 } }`.
- Triggers take `upsertInto`, `refuse(message)`, and `deferred: true` on Postgres.

## [0.92.0] - 2026-09-30

- **Breaking:** timestamps store milliseconds on every engine; `sync` migrates existing columns, `precision: 6` keeps one as is.
- **Breaking:** over HTTP, an update or delete answers the number of rows changed, not ids.
- `uql-orm/browser` no longer exports `getQuerier`, `getQuerierPool`, `setQuerierPool` or `ClientQuerierPool`: construct the `HttpQuerier` where it is used.
- On MongoDB, a `$select` without the key no longer returns `id`.
- Fixed: SQL defaults quoted by `generate:from-db`; `createTable('sales.orders')` schema; `ObjectId` comparisons on MongoDB; HTTP counts and `PATCH` from the browser client.

## [0.91.1] - 2026-09-28

- `Filled<T>` is gone: declare a field that `onInsert` or a `defaultValue` fills as optional, as before 0.91.0.

## [0.91.0] - 2026-09-28

- An insert requires every field declared `!`, except a single-column key and the `version`.
- A `type: 'time'` field is a `string`, as every driver returns it.

## [0.90.0] - 2026-09-26

- **Breaking:** `MongoQuerier` and the other MongoDB classes import from the MongoDB entry; `uql-codemod` moves them.
- Fixed: only the MongoDB entry's types need `mongodb` installed.

## [0.89.0] - 2026-09-26

- On SQL Server, a trigger's `where` works, and with `of` narrows the rows it writes for.

## [0.88.0] - 2026-09-26

- On the SQLite family, `sync` and `generate:entities` rebuild a table to retype a column, change its key or foreign keys, keeping its rows.
- A column made required fills its nulls with its default; without one, a table with rows is refused.

## [0.87.0] - 2026-09-26

- `generate:entities` renames a renamed field's column in place, keeping the data, and suggests `renameTable`.
- A retyped column casts its values on the Postgres family.

## [0.86.0] - 2026-09-26

- **Breaking:** `uql-orm/betterAuth` is gone, to return as a package of its own.

## [0.85.0] - 2026-09-25

- **Breaking:** `uql-orm/http` and `uql-orm/express` require `include` and serve only the entities it names; `exclude` is gone.
- `uql-orm/betterAuth` runs [Better Auth](https://better-auth.com) on every engine.

## [0.84.0] - 2026-09-25

- A `security` filter guards writes as it scopes reads: an insert gets its fields filled, an update cannot change them.
- Errors extend `UqlError`, carrying a `kind` and an HTTP `status`; `UqlSecurityError` answers `403`.
- Fixed: `uql-orm/http` answers `400` to a relation reaching an entity outside `include`.

## [0.83.1] - 2026-09-25

- Fixed: `$startsWith`, `$endsWith` and `$includes` match their text literally, and `$like` reads the same on every engine.

## [0.83.0] - 2026-09-24

- **Breaking:** a `Date` is the instant it names on every SQL engine, bound and read as UTC. Existing columns convert as the [upgrade guide](https://uql-orm.dev/upgrade-guide) says.
- `precision` on a `Date` field sets its fractional-second digits.

## [0.82.0] - 2026-09-24

- A trigger's `run` writes another table through its entity: one body for every engine.
- A field read off `refs(Entity)` carries its type.
- A `readonly` array or `as const` tuple is taken wherever a list is only read.
- Fixed: `updateMany` and `deleteMany` refuse a `$where` naming no rows instead of addressing the whole table.

## [0.81.0] - 2026-09-23

- A unique column is a unique index on every engine.
- `sync` and `generate:entities` rebuild an index that changed shape; a generated `down` restores a dropped column or foreign key.

## [0.80.0] - 2026-09-23

- **Breaking:** NULL compares the way each engine compares it: `$ne`, `$nin`, `$not` and `$nor` skip a NULL column on SQL. Add `{ col: null }` to an `$or` to include it.
- `@Trigger({ on, of, where, run })` declares database triggers on every SQL engine.
- `@Field({ computed, stored: ['update'] })` makes a column a stamp a trigger fills.

## [0.79.0] - 2026-09-21

- `columnType` takes an engine's own type as ``raw`tsvector` ``.
- Fixed: `length`, `precision`/`scale` and `dimensions` apply whichever option named the type.

## [0.78.0] - 2026-09-21

- `generate:from-db` carries a stored generated column over as `computed` plus `stored: true`.

## [0.77.1] - 2026-09-20

- A call the API cannot carry out throws `UqlUsageError`, answering `400` over HTTP.
- **Deprecated:** `UqlLockUsageError`, use `UqlUsageError`.

## [0.77.0] - 2026-09-19

- A versioned update is named by its id; `updateMany` over many rows is refused.
- `restoreMany` works on a versioned entity.

## [0.76.0] - 2026-09-19

- `@Field({ version: true })` makes a column an optimistic lock, throwing `UqlOptimisticLockError` (HTTP 409) when the row moved on.

## [0.75.0] - 2026-09-19

- `$sort` says where nulls land (`'ascNullsFirst'`, `'descNullsLast'`, ...), the same on every engine.

## [0.74.1] - 2026-09-19

- `generate:entities` and `sync` drop an index only when uql named it or the entity claims its name.

## [0.74.0] - 2026-09-19

- `$sort` ranks by a relation's row nearest a vector.
- A `computed` aggregate over a many-to-many needs no page.

## [0.73.1] - 2026-09-19

- Fixed: `uql-orm/migrate` loads without `mongodb` installed.

## [0.73.0] - 2026-09-18

- `WithDistance` and `WithScore` are one type, `WithProjection<E, K>`.
- On the SQLite family, a vector column created as `TEXT` before 0.71.0 reports drift: recreate it as `F32_BLOB`.

## [0.72.2] - 2026-09-18

- `$sort: { $text }` can return the relevance through `$project`.
- MongoDB reads a fulltext `config` as its language.

## [0.72.1] - 2026-09-18

- A fulltext index weighs its columns, which `$sort: { $text }` ranks by.

## [0.72.0] - 2026-09-18

- `$inc` and `$mul` update a numeric field in the statement.
- `$sort: { $text: 'desc' }` orders a `$text` search by relevance.

## [0.71.0] - 2026-09-18

- Vectors on the SQLite family and MariaDB are stored as float32 bytes, much faster; a vector index on libSQL and Turso Cloud is DiskANN.
- `@Index({ type: 'fulltext' })` works on Postgres and CockroachDB too.
- MongoDB migrations create Atlas vector search indexes.
- `uql-orm` ships an agent skill: point your `AGENTS.md` at `node_modules/uql-orm/skills/uql-orm/SKILL.md`.

## [0.70.0] - 2026-09-18

- **Breaking:** `deleteMany` and `updateMany` with no `$where` throw; pass `{ unfiltered: true }` to mean the whole table.
- A nullable column's property admits `null`, or declares `nullable: false`. `uql-codemod` rewrites it.
- `aggregate` groups by a to-one relation's field, and an aggregate filters its own rows with `$where`.
- Migrations take `transaction: false`.
- Removed: `$sumDistinct` and `$avgDistinct`.

## [0.69.0] - 2026-09-17

- Relation aggregates as fields: `@Field({ computed: (user) => user.posts.count() })`, plus `sum`, `min`, `max` and `avg`.
- Fixed: `$sum` over a BIGINT no longer rounds.

## [0.68.1] - 2026-09-17

- `WireQuery<E>` types an RPC input (tRPC, oRPC, TanStack Start).
- `D1Database` is renamed `D1Queryable`.

## [0.68.0] - 2026-09-17

- `$all` and `$elemMatch` match by content and JSON type on every engine.
- `$between` and `$not` work on JSON paths, and MySQL indexes a `jsonPath`.
- A vector search defaults to its index's metric.

## [0.67.1] - 2026-09-16

- Fixed: `HookContext` is exported from `uql-orm` again.

## [0.67.0] - 2026-09-16

- **Breaking:** the `uql-orm` root exports only the documented helpers; import the rest from `uql-orm/util`.
- `sync` and `generate:entities` read only your entities' tables.
- A cascaded write sends one statement per relation.

## [0.66.0] - 2026-09-16

- **Breaking:** every to-one declares its foreign key column and names it in `references`. `uql-codemod` adds the single-column ones.
- Definition mistakes no longer compile.

## [0.65.1] - 2026-09-14

- Fixed: relations resolve whichever entity is read first.

## [0.65.0] - 2026-09-14

- **Breaking:** a to-one names its foreign key column, `references: (post) => post.authorId`, and a `@Field({ references })` no longer adds a relation. The codemod adds it.
- A SQL querier without a native stream reads through a server-side cursor.

## [0.64.0] - 2026-09-14

- The migration builder runs on MongoDB, and MongoDB creates the indexes `@Index` declares.
- `migrationBuilderFor(querier)` replaces `new MigrationBuilder(querier)`.

## [0.63.0] - 2026-09-13

- An index expression is `raw` in the list itself: ``@Index((user) => [raw`lower(${user.email})`])``.
- Turso Cloud needs `@tursodatabase/serverless` 1.3+; a libSQL client you built goes to `LibsqlQuerierPool`.
- SQLite drivers read an integer past 2^53 as exact text.
- Removed: SQLite through `uql-orm/bunSql`; use `Sqlite3QuerierPool`.

## [0.62.0] - 2026-09-13

- `refs(Entity)` names a column in any `raw`, replacing `col()`.
- One spelling each: a check's and a filter's condition are `where`, `raw(fn, alias)` is `.as(alias)`, `$lock: { wait }` is `{ $wait }`.

## [0.61.0] - 2026-09-12

- `queryErrorKind(err)` names a failed query the same on every engine (`uniqueViolation`, `retryable`, ...).
- The HTTP handlers answer constraint violations with `409` or `400`.

## [0.60.0] - 2026-09-12

- Migrations run on MongoDB.
- `defineBuilderMigration` hands `up`/`down` the builder, the querier second.

## [0.59.0] - 2026-09-12

- `defineEntity` takes an `extends` base.

## [0.58.0] - 2026-09-11

- **Breaking:** a definition reads members off a map, `@Index((post) => [post.title])`, `mappedBy: (post) => post.author`, and an aggregate names fields by key in `$select`. `uql-codemod` rewrites them.
- Renaming a field or relation reaches every query that names it.

## [0.57.0] - 2026-09-11

- **Breaking:** a to-many `$populate` and `$count` read in the parent's statement, so MySQL needs 8.0.14+ and SQLite 3.44+.
- Every foreign key is indexed unless an index leads with it (`index: false` opts out).
- Relations and `$count` work in `findManyStream`.

## [0.56.0] - 2026-09-10

- `$text` without `$fields` searches the entity's fulltext index.
- `drift:check` reports a changed `ON DELETE` or `ON UPDATE`.

## [0.55.0] - 2026-09-10

- **Breaking:** a BIGINT past 2^53 reads as its exact text, where most drivers rounded it.
- A `bigint` past 2^53 is written exactly on every driver.
- `CrdbQuerier`/`NeonQuerier` are `PgQuerier`, `LibsqlQuerier`/`TursoQuerier` are `HranaQuerier`.
- SQL Server streams with backpressure, and a dropped connection no longer crashes the process.

## [0.54.0] - 2026-09-10

- An `after*` hook sees the row as written, generated id included.
- Every upsert reports every id, in payload order.
- Removed: `virtual` and `raw('sql')`. `uql-codemod` rewrites both.

## [0.53.0] - 2026-09-10

- **Breaking:** `$where` takes a map only: ids are `{ id: [1, 2] }`, a bare `raw()` goes in `$and`.
- `QueryWhereMap` is `QueryWhere`.
- Vector search on SQL Server 2025, and SQL Server migrations alter, rename and drop columns.

## [0.52.0] - 2026-09-09

- Microsoft SQL Server 2017+, through `uql-orm/mssql`.
- `findManyStream` streams for real on Bun SQL (Postgres, CockroachDB) and PGlite.

## [0.51.0] - 2026-09-09

- An upsert reports the entity's id, in payload order.

## [0.50.0] - 2026-09-09

- Every write method reports an id in one shape, and a composite insert reports its key.

## [0.49.0] - 2026-09-09

- **Breaking:** a key not called `id`, `_id` or `uuid` needs the `idKey` brand, a composite always. `uql-codemod` writes it.

## [0.48.0] - 2026-09-09

- **Breaking:** `saveOne`/`saveMany` upsert on the key a row names, and fire `@BeforeUpsert`/`@AfterUpsert` instead of the update hooks.
- **Breaking:** MongoDB stores and returns the key you declare; a minted one reads as a hex string.
- A one-to-one update replaces its child.

## [0.47.1] - 2026-09-09

- Fixed: `$not` and `$nor` at the root of a MongoDB `$where`; `{ $and: [] }`.

## [0.47.0] - 2026-09-09

- `$limit`/`$skip` inside a to-many `$populate` are per parent, and a many-to-many `$populate` can order and page.
- Bun SQL enforces foreign keys on SQLite.

## [0.46.0] - 2026-09-08

- `@Field({ computed, stored })` declares a column the database computes.
- **Deprecated:** `virtual`, renamed `computed`.
- `introspect(tables?)` reads just the tables named.

## [0.45.0] - 2026-09-08

- A sync applies foreign key changes, except on SQLite.
- A generated key is typed from its declaration, so MySQL and MariaDB keys lose `UNSIGNED`; a key filled by `onInsert` is not auto-increment.
- Removed: `serial`, `bigserial` and `smallserial` as `columnType`.

## [0.44.0] - 2026-09-07

- A schema can be defined at run time, `sync({ entity })` gives it a table. See [Runtime Schemas](https://uql-orm.dev/entities/runtime).
- `uql-migrate types` writes a `.d.ts` for the registered entities.
- `autoSync()`, `syncForce()` and `syncEntity(e)` are `sync()`, `sync({ force: true })` and `sync({ entity: e })`.

## [0.43.0] - 2026-09-07

- An option a column cannot use is an error instead of ignored.
- Fixed: drift misses a mismatched column type.

## [0.42.1] - 2026-09-05

- A migration can change a primary key.
- Constraint names read `<table>__<columns>_<kind>`; nothing existing is renamed.

## [0.42.0] - 2026-09-04

- Composite primary keys: a second `@Id` makes the key composite, addressed by an object naming every key.
- A typo'd `@Field` / `@Id` option is a compile error.

## [0.41.1] - 2026-09-04

- Enum fields, `@Field({ type: String, enum: [...] as const })`, enforced by a `CHECK` and by TypeScript.
- Table-level `CHECK` constraints through `@Entity({ checks })`.

## [0.40.0] - 2026-09-04

- `raw` is a tagged template, binding every interpolation.
- **Deprecated:** `raw('sql')`. `uql-codemod` rewrites it.

## [0.39.0] - 2026-09-03

- `$near` filters by vector distance in `$where`, and `$candidates` sets ANN recall per query.

## [0.38.0] - 2026-09-03

- Indexes inside a JSON column, through `jsonPath` and `jsonArray`.
- The dialects moved to their own entries (`uql-orm/postgres`, `/mysql`, `/maria`, `/sqlite`).

## [0.37.1] - 2026-09-02

- Fixed: `findManyAndCount` with a `$lock` on the Postgres family, and with `$distinct`.

## [0.37.0] - 2026-09-02

- `exists`, `estimatedCount`, a capped `count`, and `$count` on relations, sortable.
- `findManyAndCount` is one statement on SQL.

## [0.36.0] - 2026-09-01

- `expr` defaults resolve per dialect; `expr.uuidv7()` is new.

## [0.35.0] - 2026-09-01

- The migration expression helper is `expr`, freeing `t` for the table callback.

## [0.34.1] - 2026-08-31

- Migrations understand `schema`.

## [0.34.0] - 2026-08-31

- `@Entity({ schema })`, and a default `schema` per pool.

## [0.33.0] - 2026-08-30

- The HTTP handler takes its pool as an option, or a function choosing one per request.
- Removed: `setQuerierPool`, `getQuerierPool` and `getQuerier`: pass the pool where it is used.

## [0.32.1] - 2026-08-30

- A populated to-many is always a list.

## [0.32.0] - 2026-08-30

- Find results are narrowed to what `$select` and `$exclude` projected.

## [0.31.5] - 2026-08-30

- MongoDB orders by a relation you did not populate.
- Type-checking is about a quarter cheaper.

## [0.31.4] - 2026-08-28

- Fixed: MongoDB ignoring `$distinct`, and `$limit` on `updateMany`/`deleteMany`.

## [0.31.3] - 2026-08-27

- A vector `$sort` works on `updateMany`/`deleteMany`.
- Type-checking is about twice as fast.

## [0.31.2] - 2026-08-27

- `Json<T>[]` is a field, not a relation.

## [0.31.0] - 2026-08-23

- PGlite: Postgres in-process, through `uql-orm/pglite`.
- `$populate` checks a relation's own `$select`/`$exclude`/`$sort`.

## [0.30.0] - 2026-08-20

- `count()` takes a filter only; `$limit: 0` returns zero rows.
- `$sum`/`$avg`/`$min`/`$max` are `| null` and take numeric columns only.
- Fixed: `@BeforeDelete`/`@AfterDelete` receive the deleted rows; a nullish id throws instead of addressing every row.

## [0.29.0] - 2026-08-20

- **Breaking:** `@Transactional()` and `currentQuerier()` are gone: wrap the body in `pool.transaction(async (querier) => ...)`.
- Releasing a querier with a transaction open rolls it back.

## [0.28.1] - 2026-08-16

- Fixed: MongoDB queries that filter, order and populate at once.

## [0.28.0] - 2026-08-16

- Ordering by a related field no longer needs `$populate`.
- Fixed: a group nested in `$and`/`$or`/`$not` losing its parentheses; `$i*` operators on case-sensitive collations.

## [0.27.0] - 2026-08-15

- `$lock` locks the rows a read returns, with `skip` and `nowait`.

## [0.26.2] - 2026-08-10

- `deleteMany` spends one statement unless it cascades or pages.

## [0.26.0] - 2026-08-09

- `sync` creates an index added to an existing entity, and `drift:check` reports one that changed.

## [0.25.1] - 2026-08-08

- `@Field({ references, onDelete })` cascades without a relation.

## [0.25.0] - 2026-08-08

- `onDelete`/`onUpdate` per relation.
- `bun:sqlite` and Turso enforce foreign keys.
- Fixed: `sync` and `generate:entities` leaving out foreign keys; cascade delete order.

## [0.24.7] - 2026-08-07

- Reads decode each value to the type its field declares.

## [0.24.6] - 2026-08-05

- Fixed: MongoDB ignoring `$select`/`$exclude` beside a relation.

## [0.24.3] - 2026-08-03

- `onInsert`, `onUpdate` and `defaultValue` must produce the field's type.

## [0.24.2] - 2026-08-03

- Fixed: field names unchecked in a project without `@types/node`.

## [0.24.1] - 2026-08-02

- `mappedBy` callbacks no longer need a `!`.

## [0.24.0] - 2026-08-02

- The pool runs every operation, so a helper can take a querier or the pool.

## [0.23.0] - 2026-08-01

- **Breaking:** decorators are the standard TC39 ones: no `experimentalDecorators` or `reflect-metadata`, and `type` is required on every `@Field`/`@Id`. `uql-codemod` does most of it; see the [upgrade guide](https://uql-orm.dev/upgrade-guide).
- `NodeSqliteQuerierPool` runs on `node:sqlite`.
- `await using querier = await pool.getQuerier()` releases on scope exit.

## [0.22.0] - 2026-07-31

- Vector search on every engine that has it.
- Index entries take expressions, prefix lengths, order, `INCLUDE` and operator classes.
- Turso: `uql-orm/turso` and `uql-orm/turso/local`.
- `addColumn`/`alterColumn` take a callback declaring the column.

## [0.21.0] - 2026-07-30

- `reflect-metadata` and `jiti` are optional peers.
- Relation filtering and `$size` on MongoDB.
- Fixed: relation subqueries bypassing `security: true` filters.

## [0.20.1] - 2026-07-27

- Fixed: a `security: true` filter skipped by a `$populate` with no `$where`.

## [0.20.0] - 2026-07-26

- `$merge` is `$set`, and `$pull` removes matching elements.
- Vector indexes declare `distance`.
- Fixed: `$push` onto a missing key on MariaDB and MySQL; MongoDB JSON operators stored as data.

## [0.19.0] - 2026-07-24

- Operators are typed per field, and JSON dot-paths are checked.

## [0.18.0] - 2026-07-23

- `$countDistinct`.

## [0.17.1] - 2026-07-20

- Logging: `slowQuery: 200`, and `logValues` (default `false`) replaces `logParams`.

## [0.17.0] - 2026-07-19

- A typo'd query key is a compile error.
- The SQLite family uses `RETURNING`.

## [0.16.0] - 2026-07-19

- `$group` lists the grouped columns, `$agg` the functions.

## [0.15.2] - 2026-07-10

- `insertMany` mixes rows with different columns and splits past the driver's bind limit.

## [0.15.0] - 2026-07-09

- `pool.findMany`/`findOne`/`count`/`aggregate` run one operation each.

## [0.14.1] - 2026-07-09

- `captureContext()` and `pool.withQuerier(cb, { context })`.

## [0.14.0] - 2026-07-08

- Query filters, `@Filter`, and `security` filters for multi-tenancy.
- `restoreOneById`/`restoreMany` and `withDeleted()`.
- Permanent deletes use `hardDelete` (was `{ softDelete: false }`).

## [0.12.0] - 2026-07-06

- `softDelete` moves from `@Entity` to `@Field`.

## [0.11.0] - 2026-07-06

- Foreign key columns are created from relations.

## [0.10.1] - 2026-07-03

- Fixed: 0.10.0 shipped only the browser bundle.

## [0.10.0] - 2026-07-02

- `uql-orm/http`, a framework-agnostic handler, and `uql-orm/nestjs`.
- Hooks receive one `HookContext` and abort by throwing.

## [0.9.4] - 2026-06-29

- The `$entity` call form is restored.

## [0.9.2] - 2026-06-10

- Fixed: Express's `req.query` discarding the middleware's coercion.

## [0.8.4] - 2026-04-11

- `$populate` for relations and `$exclude` for subtractive projection.

## [0.8.2] - 2026-04-04

- Fixed: generated migrations with LibSQL.

## [0.8.0] - 2026-04-03

- `defineEntity`, `defineField`, `defineId` and `defineRelation` for decorator-free entities.

## [0.7.10] - 2026-04-02

- JSON columns returned as text are parsed back.

## [0.7.9] - 2026-03-31

- `MongoDialect` imports from `uql-orm/mongo`.

## [0.7.0] - 2026-03-19

- Bun SQL, through `uql-orm/bunSql`.
- **Breaking:** `$ne` is null-safe everywhere, so rows with `NULL` in the column are included.

## [0.6.0] - 2026-03-18

- `$push` appends to a JSON array atomically.

## [0.5.0] - 2026-03-15

- CockroachDB.

## [0.4.0] - 2026-03-13

- `findManyStream()`.
- Removed: the deprecated `reference` field option; use `references`.

## [0.3.1] - 2026-03-12

- MongoDB Atlas vector search.

## [0.3.0] - 2026-03-12

- Vector similarity search through `$sort`, and vector columns and indexes.

## [0.2.7] - 2026-03-11

- `$size` takes comparison operators.

## [0.2.2] - 2026-03-09

- `querier.aggregate()`.

## [0.2.0] - 2026-03-08

- Transaction isolation levels.

## [0.1.1] - 2026-03-08

- Fixed: columns containing underscores unflattened into nested objects.

## [0.1.0] - 2026-03-08

- `@uql/core` is renamed `uql-orm`, reset to `0.1.0`. New home: [uql-orm.dev](https://uql-orm.dev).

Releases before the rename were published as `@uql/core` (`3.15.0` and earlier). Steps between versions: the [upgrade guide](https://uql-orm.dev/upgrade-guide).
