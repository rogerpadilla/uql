# Changelog

Newest first, `[yyyy-mm-dd]`. One short line per change: what changed for users, not how or why. `**Breaking:**` leads when it breaks user code. No internals, sizes or tests.

## [0.89.0] - 2026-09-26

- **Breaking:** a custom dialect's trigger `features` state `fires` (`'eachRowWhen'`, `'eachRowIf'` or `'eachStatement'`) in place of `guards` and `rows`.
- **Breaking:** on SQL Server, a trigger's `where` now works, and with `of` narrows the rows `insertInto`, `updateTable` and `deleteFrom` write for, as other engines fire for them. A body of its own SQL beside either is refused. `sync` replaces SQL Server triggers with `of`.
- **Breaking:** the types refuse a relation's `$size` beside a condition on its rows, as the engine already did, and `$text`'s `$fields` takes string fields only.

## [0.88.0] - 2026-09-26

- **Breaking:** a custom dialect's `features` states `rebuildsTables` in place of `foreignKeyAlter`, `primaryKeyAlter` and `generatedColumnAdd`, and `alterColumnSyntax` no longer takes `'none'`.
- On SQLite, libSQL, Turso and D1, `sync` and `generate:entities` rebuild a table to retype a column, change its nullability or default, change a key or a foreign key, or add a stored computed column, keeping its rows and the rows referencing it. A SQLite migration runs with foreign keys off and checked before it commits; where they stay on, a rebuild of a table others reference is refused.
- A column made required fills its nulls with its default. Without one, on a table holding rows, `sync` and `generate:entities` refuse it with the row count, where MySQL filled in zeros.
- **Fixed:** on SQL Server, a trigger with `of` writes only for the rows whose watched column changed, as on every other engine, where it wrote for every row of the statement once one had. `sync` replaces those triggers.

## [0.87.0] - 2026-09-26

- **Breaking:** `SqlSchemaGenerator.generateAlterColumnStatements` is gone: a custom generator alters a column through `generateAlterTable`.
- `generate:entities` renames a column in place when its field was renamed but not otherwise changed, keeping the data, and suggests `renameTable` for a new table the database holds under another name.
- A retyped column casts its values on the Postgres family, so text holding numbers can become a number, and `generate:entities` names every column it drops or narrows.

## [0.86.0] - 2026-09-26

- **Breaking:** `uql-orm/betterAuth` is gone, to return as a package of its own, and a custom dialect's `features` no longer states `transactions`.

## [0.85.0] - 2026-09-25

- **Breaking:** `uql-orm/http` and `uql-orm/express` require `include` and serve only the entities it names, never one for being defined. `exclude` is gone.
- **Breaking:** a custom dialect's `features` states `transactions`, whether the engine runs a transaction across statements.
- `uql-orm/betterAuth` runs [Better Auth](https://better-auth.com) on every engine UQL does: `uqlAdapter(pool)` is its database, and `authEntities(options)` its tables for `uql-migrate`.

## [0.84.0] - 2026-09-25

- **Breaking:** a `security` filter guards writes as it scopes reads. An insert gets the fields it names filled and refuses another value, an update refuses changing one, and a save or upsert keyed on a row outside it fails on the key instead of overwriting that row. A filter that is not plain field equalities refuses writes.
- **Breaking:** the errors UQL raises extend `UqlError`, which carries their `kind` and HTTP `status`, so `UqlUsageError` is no longer a `TypeError`. `UqlSecurityError` answers `403` over `uql-orm/http`, not `500`.
- **Fixed:** `uql-orm/http` answers `400` to a relation leading to an entity outside `include`, at any depth of a query or a written row, where it read or wrote that entity's rows.
- **Fixed:** `uql-orm/http` no longer counts on `?count=false`.

## [0.83.1] - 2026-09-25

- **Fixed:** the `$like` family reads the same on every engine. `$startsWith`, `$endsWith`, `$includes` and their `$i` twins match their text literally, so a `%`, `_` or `[` in it (a `.` or `(` on MongoDB) is no longer a wildcard. A `$like` pattern is whole-string on MongoDB too, `\` escapes on SQLite, D1 and SQL Server too, and `[` is no longer a character class on SQL Server; one ending in a `\` with nothing to escape (`'John\'`) is refused.
- **Fixed:** a `$select` list naming a field instead of a `raw()` expression is refused, and `uql-orm/http` answers `400` to one, as to a `QUERY` body that is not a JSON object.

## [0.83.0] - 2026-09-24

- **Breaking:** a `Date` is the instant it names on every SQL engine, whatever zone the process runs in: bound as UTC, and a zoneless timestamp or a `DATE` read as UTC. A `Date` field is a `TIMESTAMPTZ` on Postgres and CockroachDB, a `DATETIME(3)` on MySQL and MariaDB, and UTC text on the SQLite family, as are the builder's `createdAt()` and `updatedAt()`. Existing columns convert as the [upgrade guide](https://uql-orm.dev/upgrade-guide) says.
- `precision` on a `Date` field sets its fractional-second digits, which drift and migrations compare.
- **Fixed:** a `Date` with milliseconds matches on SQL Server, and a date written into Postgres SQL reads as UTC.

## [0.82.0] - 2026-09-24

- A trigger's `run` writes another table through its entity (`insertInto`, `updateTable`, `deleteFrom`): one body for every engine, SQL Server's included.
- A field read off `refs(Entity)` or a trigger's rows carries its type, so a mistyped `$where`, update or trigger-write value is a compile error.
- A `readonly` array or `as const` tuple is taken wherever a query or write only reads a list: `$in`, `$between`, `$and`/`$or`, `insertMany`, raw `all`/`run`, and so on.
- Every misuse of the API throws `UqlUsageError` (kind `usage`, `400` over HTTP), still a `TypeError`.
- **Fixed:** `updateMany` and `deleteMany` refuse a `$where` naming no rows, such as `{ id: undefined }` or `{ $or: [] }`, instead of addressing the whole table.
- **Fixed:** a trigger's `where` no longer picks up the entity's soft-delete or security filter.
- **Fixed (MongoDB):** an unknown `$where`/`$having` operator or a `$between` without two bounds is refused before sending, as on SQL.

## [0.81.0] - 2026-09-23

- **Breaking:** `SchemaDiff`, for code driving the migrator directly, lists `columns`, `indexes`, `foreignKeys` and `primaryKey` as `{ from?, to? }` changes in place of the nine `*ToAdd`/`*ToDrop`/`*ToAlter` fields.
- A unique column is a unique index (`<table>__<column>_idx`) on every engine, so `sync` and `generate:entities` add and drop it like any index.
- `sync` (outside safe mode) and `generate:entities` rebuild an index that differs in order, nulls, operator class, included columns or vector distance.
- A generated migration's `down` restores a dropped column or foreign key.
- `drift:check` compares defaults as `generate:entities` does, and a vector index's `distance`.
- **Fixed:** indexes pair by name, then by columns, so one under a legacy name is no longer reported both missing and unexpected.
- **Fixed (SQL Server):** dropping a column drops its indexes first.

## [0.80.0] - 2026-09-23

- **Breaking:** NULL compares the way each engine compares it: `$ne`, `$nin`, `$not` and `$nor` render plain `<>`, `NOT IN` and `NOT`, so a SQL engine skips a NULL column where MongoDB keeps it. Add `{ col: null }` to an `$or` to include it.
- `@Trigger({ on, of, where, run })` declares database triggers on every SQL engine: `of` lists watched columns, `where` is an `$old`/`$new` predicate or SQL, `run` is SQL for every engine or one per engine. SQL Server takes only after events and no `where`.
- ``@Field({ computed: raw`CURRENT_TIMESTAMP`, stored: ['update'] })`` makes a column a stamp a trigger fills, whoever writes the row.
- `sync` and `generate:entities` install and drop declared triggers, leaving hand-written ones alone. MongoDB refuses a write to an entity declaring one.

## [0.79.0] - 2026-09-21

- `columnType` takes an engine's own type as ``raw`tsvector` ``, rendered verbatim, for `ltree`, `inet`, `citext`, geometry, ranges and the like.
- **Fixed:** `length`, `precision`/`scale` and `dimensions` apply whichever option named the type; a column created before reads as drift and is altered to its declared width.

## [0.78.0] - 2026-09-21

- `generate:from-db` carries a stored generated column over as `computed` plus `stored: true`, on every SQL engine, where it scaffolded a plain writable field before. One the engine recomputes per read instead (SQL Server's unpersisted column, SQLite's `VIRTUAL`) has no spelling in uql and still scaffolds plain.

## [0.77.1] - 2026-09-20

- A call the API cannot carry out: a `$lock` outside a transaction or on an engine without row locks, etc, throws `UqlUsageError` (kind `usage`), so it answers `400` over HTTP instead of `500`. It is still a `TypeError`, and `queryErrorKind(err)` names it as it names a driver's error.
- **Deprecated:** `UqlLockUsageError` is `UqlUsageError` under its old name.
- A `$near` with no bound (`$lt`, `$lte`, `$gt`, `$gte` or `$between`) is a compile error: it filtered nothing.
- MongoDB refuses a `$lock` in the same words the SQLite family does.

## [0.77.0] - 2026-09-19

- **Breaking:** a versioned update is named by its id, so `updateMany` over a filter matching many rows is refused: one version cannot say which row it belongs to.
- `restoreMany` works on a versioned entity, carrying no version, as a delete already did: both move the row's lifecycle rather than its content.
- A versioned update that matched nothing says which of three happened: the row is gone, its version moved on, or another `$where` condition excluded it.
- A write that cannot carry the lock answers `400` over HTTP instead of `500`: a payload with no version, or `save` and `upsert` on a versioned entity.

## [0.76.0] - 2026-09-19

- `@Field({ version: true })` makes a column an optimistic lock, on every engine: an update carries the version it read and writes the next, and throws `UqlOptimisticLockError` (kind `optimisticLock`, HTTP 409) when the row has moved on instead of overwriting it. Leaving the version out of an update is a compile error; `save`, `upsert` and `restoreMany` are refused on such an entity.
- Fixed: an `onInsert` or `onUpdate` of `0`, `''` or `false` is written instead of skipped.

## [0.75.0] - 2026-09-19

- `$sort` says where nulls land - `'ascNullsFirst'`, `'ascNullsLast'`, `'descNullsFirst'`, `'descNullsLast'` - and answers the same order on every engine, emulated on MySQL, MariaDB, SQL Server and MongoDB, which have no placement of their own. Unqualified, each engine keeps its own: Postgres and CockroachDB sort nulls last on `asc`, the rest first.

## [0.74.1] - 2026-09-19

- `generate:entities` and `sync({ safe: false })` drop an index the entity no longer declares, or whose columns changed, only when uql named it or the entity still claims its name. An index named by hand is left alone. On every engine, MongoDB included.
- Fixed (MySQL, MariaDB, MSSQL): an index redeclared with new columns under its old name no longer fails as a duplicate.
- Fixed: a generated migration's `down` undoes each table's changes in order; a changed foreign key was added back before the new one was dropped..

## [0.74.0] - 2026-09-19

- `$sort` ranks by a relation's row nearest a vector, `{ chunks: { embedding: { $vector } } }`, through a to-one, one-to-many or many-to-many, on every engine with vector search and on MongoDB without Atlas.
- A `computed` `sum`, `min`, `max` or `avg` over a many-to-many's target column needs no page; MongoDB read it as `null`.
- Fixed: a `$vector` sort, its `$project` or a `$near` beside a join no longer fails on a column both tables have.

## [0.73.1] - 2026-09-19

- Fixed: `uql-orm/migrate` loads without `mongodb` installed.

## [0.73.0] - 2026-09-18

- **Breaking (types):** `WithDistance` and `WithScore` are one type, `WithProjection<E, K>`, for the row any `$sort` `$project` names.
- **Breaking (SQLite, libSQL, Turso):** a vector column created as `TEXT` before 0.71.0 is reported as drift; recreate its table with the column as `F32_BLOB`, which libSQL's vector index needs.
- Fixed: a field given both `$inc` and `$mul` throws, where `$mul` was silently dropped.

## [0.72.2] - 2026-09-18

- `$sort: { $text }` takes either direction, and `{ $project: 'score', $order? }` also returns the relevance, typed with `WithScore<E, 'score'>`.
- MongoDB reads a fulltext `config` as its language; **changed:** an index with none no longer stems, as on SQL, and `drift:check` reports one built in another language.
- Fixed: `$text` beside a `$populate` join no longer fails on a column both tables have.
- Fixed (SQLite): `$text`.
- Fixed: `$project` refuses a name that collides with a field, column, relation, `_id` or `_uql` name; MongoDB overwrote the field.
- Fixed (MongoDB): 64-bit integers read back exactly.

## [0.72.1] - 2026-09-18

- A fulltext index weighs its columns, `{ column: post.title, weight: 3 }`, which `$sort: { $text }` ranks by on every engine with full-text search.
- Fixed (MongoDB): `drift:check` reads a text index's fields, rather than reporting every one as drifted.
- Fixed (MySQL, MariaDB): a fulltext index added to a table with rows is followed by `OPTIMIZE TABLE`, without which InnoDB scores it 0 or fails the search.

## [0.72.0] - 2026-09-18

- `$inc` and `$mul` add to and multiply a numeric field in the statement, `{ stock: { $inc: -1 } }`, a NULL counting as 0.
- `$sort: { $text: 'desc' }` orders a `$text` search by relevance, on every engine with full-text search.

## [0.71.0] - 2026-09-18

- **Breaking:** a `$group` path through a relation reads only rows that have one, so its column is typed as the field is; group by the foreign key to count rows pointing nowhere.
- **Breaking (libSQL, Turso Cloud):** a vector `@Index` builds a DiskANN index, which a ranked, paged `$vector` sort reads; drift names one still built plain.
- Vectors on SQLite, libSQL, Turso and MariaDB are stored and searched as float32 bytes, much faster.
- MongoDB migrations create the Atlas vector search index a `type: 'vectorSearch'` `@Index` declares.
- `@Index({ type: 'fulltext' })` works on PostgreSQL and CockroachDB too, so one declaration serves `$text` everywhere; `config` names its text-search configuration.
- `uql-orm` ships an agent skill: point your `AGENTS.md` at `node_modules/uql-orm/skills/uql-orm/SKILL.md` and it follows every upgrade.

## [0.70.0] - 2026-09-18

- **Breaking:** `deleteMany` and `updateMany` naming no rows (no `$where`, no `$limit`) throw; pass `{ unfiltered: true }` to mean the whole table.
- **Breaking (types):** a nullable column's property admits `null` (`name?: string | null`), or declares `nullable: false`. `npx uql-codemod` rewrites it.
- **Breaking (types):** writes refuse `readonly` fields the database fills (relation aggregates, generated columns), which were silently dropped.
- **Breaking:** `$sumDistinct` and `$avgDistinct` are removed; `$countDistinct` stays.
- `aggregate` groups by a to-one relation's field, `$group: { orderId: { transaction: { orderId: true } } }`, and groups and totals relation-aggregate fields, on every engine.
- An aggregate filters its own rows with `$where` beside its op, `{ $sum: { amount: true }, $where: { account: 'fee' } }`, so one statement pivots rows into columns.
- Migrations take `transaction: false`, for statements like `CREATE INDEX CONCURRENTLY`.
- Fixed: `$sum` over a `bigint` column is typed `bigint`.
- Fixed (MongoDB): `count` and `aggregate` filter by relations and relation aggregates, skip soft-deleted rows, and return no `_id`.
- Fixed (MongoDB): a `$sum` over no values is `null`, as on SQL, `$count: { field }` skips a document missing the field, and relation aggregates work under a naming strategy.
- Fixed (Turso): writes filtered by a relation or relation aggregate run.

## [0.69.0] - 2026-09-17

- Relation aggregates as fields: `@Field({ computed: (user) => user.posts.count() })`, plus `sum`, `min`, `max` and `avg`, usable in `$select`, `$where` and `$sort` on every engine.
- MongoDB refuses a SQL `computed` field by name instead of returning `undefined`.
- Fixed: `$sum` over a BIGINT no longer rounds.
- Fixed (Postgres, CockroachDB): introspection no longer fails when a table is dropped mid-scan.

## [0.68.1] - 2026-09-17

- `WireQuery<E>` types an RPC input (tRPC, oRPC, TanStack Start).
- Fixed: the browser client refuses a `raw` fragment and a `Uint8Array`, which were sent broken.
- **Breaking (types):** `D1Database` is renamed `D1Queryable`; the codemod renames it.
- **Breaking (types):** query types take `Raw` before the key set: `QueryWhere<E, Raw, K>`.

## [0.68.0] - 2026-09-17

- **Breaking:** `$all` and `$elemMatch` match an element by its content, nested too, and by JSON type (`'5'` no longer matches `5`), on every engine.
- **Breaking (MongoDB):** `$pull` compares an object's key order, as SQLite and SQL Server do.
- **Breaking:** a vector search defaults to its index's metric.
- `$between` and `$not` work on JSON paths, and MySQL indexes a `jsonPath`.
- Fixed: JSON numbers sort and compare by value, and a path holding no array matches no `$size`, `$all` or `$elemMatch`.
- Fixed (Postgres, CockroachDB): a numeric JSON comparison no longer fails on a row holding text; regenerate numeric `jsonPath` indexes.
- Fixed (MySQL): `$elemMatch` returns the right rows on large tables.
- Fixed (MongoDB): `$size` takes bounds, and every relation `$size` applies.
- Fixed (MariaDB): vectors keep every float32 digit.

## [0.67.1] - 2026-09-16

- **Fixed: `HookContext` is exported from `uql-orm` again**, where the lifecycle hooks guide imports it.

## [0.67.0] - 2026-09-16

- **Breaking: the `uql-orm` root exports only the documented helpers, `raw`, `refs`, `withDeleted` and `DefaultLogger`**; import the rest from `uql-orm/util`. `COLUMN_TYPES_BY_FAMILY` is now `COLUMN_TYPES`.
- **Breaking (types): `FieldValue` and `RelationValue` are gone**; use `E[FieldKey<E>]` and `E[RelationKey<E>]`.
- **Breaking (custom dialects): capability flags live in `features`**, so `supportsRowLocks` is `features.rowLocks`; `featureDefaults` and `featureOverrides` are gone.
- **`sync` and `generate:entities` read only your entities' tables**, so they are faster on a large database and leave other tables, and foreign keys to them, alone.
- **A cascaded write sends one statement per relation**, not one per parent.
- **Fixed (Postgres, CockroachDB): reading the schema handles a table name used in two schemas**, composite foreign keys and composite unique constraints.
- **Fixed (MongoDB): views are no longer read as collections.**
- **Fixed: `updateMany` cascades to the right rows when it changes a column its `$where` filters on**, without firing `afterLoad`.
- **Fixed (codemod): a to-one without a declared `<relation>Id` column is reported** instead of rewritten into a broken relation.

## [0.66.0] - 2026-09-16

- **Breaking: every to-one declares its foreign key column and names it in `references`**; a relation no longer creates one. A composite key pairs a column per key. `npx uql-codemod` adds the single-column ones.
- **Breaking (types): definition mistakes no longer compile**: a join column that cannot hold its key, `mappedBy` naming a method, a column referencing a composite key, a skipping security filter, a `softDelete` filter name.
- **A relation joining a non-column, or a foreign key to another entity, throws on first read.**
- **Fixed: a primary key that references another entity is no longer database-generated**, and `getSqlType` respects a foreign key's `columnType`.
- **Fixed: `@Entity({ relations })` callbacks are typed against the decorated class.**

## [0.65.1] - 2026-09-14

- **Fixed: relations resolve whichever entity is read first**; reading a junction or an inverse side before its other end threw.

## [0.65.0] - 2026-09-14

- **Breaking: a to-one names the foreign key column it declares**, `references: (post) => post.authorId`, instead of matching it by name; the codemod adds it. `uql-orm/postgres` grows 0.5 KB gzipped.
- **Breaking: a `@Field({ references })` column no longer adds a relation**: declare one to `$populate` it. Its foreign key constraint stays.
- **Breaking: `through` finds each junction column by its `references`**, not by the `<entity><Key>` name.
- **Breaking (types): `defineEntity` relation options match the decorators'**, so what a decorator refuses no longer compiles.
- **`generate:from-db` writes each relation's `references`**, so a foreign key not named `<relation>Id` is no longer duplicated.
- **Fixed**: every entity extending a base gets its relations' foreign key columns, and a relation that cannot resolve throws on every read.
- **A SQL querier without a stream of its own reads through a server-side cursor** where the engine has one, instead of loading every row.
- **Breaking: `Migrator.dialectName`, `Migrator.createIntrospector` and `BunSqlQuerierPool.sqlDialectName` are gone**: read `pool.dialect.dialectName`.
- **Breaking (drivers): `driverCapabilities` is a Postgres-wire dialect option**, read from `dialect.driverCapabilities`; `supportsJsonb` and the `'lastId'` insert-id source are gone.

## [0.64.0] - 2026-09-14

- **Breaking: `migrationBuilderFor(querier)` and `await migrator.getSchemaGenerator()`** replace `new MigrationBuilder(querier)` and `ensureSchemaGenerator()`; the migrator's other generator helpers are gone.
- **The migration builder runs on MongoDB**, managing collections and their indexes through `defineBuilderMigration<MongoQuerier>`.
- **MongoDB creates the indexes `@Index` declares**, a partial one's `where` as its `partialFilterExpression`; options it lacks throw.
- **A partial index predicate an engine cannot hold throws at generation**, naming the operator, such as `$or` on SQL Server.
- **Breaking: `Dialect.escape` writes a `Date` in UTC**, so generated DDL is the same on every machine.

## [0.63.0] - 2026-09-13

- **Breaking: an index expression is `raw` in the list itself**, ``@Index((user) => [raw`lower(${user.email})`])``; the migration builder takes `raw` too.
- **Breaking: SQLite through `uql-orm/bunSql` is gone**: use `Sqlite3QuerierPool`, which runs on `bun:sqlite` under Bun.
- **Breaking: Turso Cloud needs `@tursodatabase/serverless` 1.3+**, with a session per querier, so transactions, streams and every `Config` option work.
- **Breaking: a libSQL client you built goes to `LibsqlQuerierPool`**, no longer `TursoQuerierPool`, and `end()` leaves it open.
- **SQLite drivers read an integer past 2^53 as its exact text**, where they rounded it or threw; D1 still returns a number.

## [0.62.0] - 2026-09-13

- **Breaking: SQL an entity declares reads columns off refs**, ``(user) => raw`lower(${user.email})` ``; a check or partial-index `where` also takes `{ deletedAt: null }`.
- **`refs(Entity)` names a column in any `raw`**, escaped and alias-qualified, replacing `col()`.
- **Breaking: one spelling each**: a check's `expression` and a filter's `condition` are `where`, a partial-index string is `raw`, `raw(fn, alias)` is `.as(alias)`, `$lock: { wait }` is `{ $wait }`.
- **DDL renders per engine with values as literals**: checks, partial indexes, stored computed columns and the migration builder; an unnamed expression index is named `expr0`.
- **Fixed**: raw `$having` operands, raws in `$and`/`$or` losing the join alias, `.as()` outside `$select`, an expression index hiding a foreign key's, and MongoDB refusing `$lock: false`.
- **Breaking (dialects): `addValue` takes the context, `compileDdl` renders a schema's SQL and `QueryRaw` holds only a callback**; `ddlText` is gone.

## [0.61.0] - 2026-09-12

- **`queryErrorKind(err)` names a failed query the same way on every engine** (`uniqueViolation`, `foreignKeyViolation`, `notNullViolation`, `checkViolation`, `retryable`), so a 409 or a retry needs no driver codes.
- **The HTTP handlers answer constraint violations with `409 Conflict` or `400 Bad Request`**, where every database failure was a `500`.

## [0.60.0] - 2026-09-12

- **`defineBuilderMigration` hands `up`/`down` the builder**, where it passed the querier and `m.createTable` failed; the querier comes second, for a backfill in the same transaction.
- **Migrations run on MongoDB**: `defineMigration<MongoQuerier>` is typed, history lives in a `uql_migrations` collection, and `generate`/`generate:entities` write driver calls instead of `querier.run`.

## [0.59.0] - 2026-09-12

- **`defineEntity` takes an `extends` base**, inheriting its fields, relations, hooks and filters where the class cannot extend one: minted at runtime, or its base chosen from data.

## [0.58.0] - 2026-09-11

- **Renaming a field or relation reaches every query that names it**: `$select`, `$exclude`, `$where`, `$sort`, `$populate`, `$count`, `$group`, writes and result rows, where before only the entity and the insert payload followed.
- **Breaking: a definition reads members off a key map**: `@Index((post) => [post.title])`, `mappedBy: (post) => post.author`, `references`, and `defineEntity`'s `indexes` and `hooks`; `npx uql-codemod` rewrites them. A `through` relation takes no `references`.
- **Breaking: a statement names a field by a key, never a string**: an aggregate reads `{ $sum: { amount: true } }` and `$text` `$fields: { title: true }`, so a rename reaches them too.
- **Breaking: `aggregate()` takes its computed columns in `$select`**, where `$agg` repeated the method's name. `$group` still lists the grouped ones; `npx uql-codemod` rewrites both changes.
- **Breaking (types): `RelationOptions` takes its target, with no `any` default; `RelationMeta` and `IndexOptions` are no longer generic; `RelationKeyMap` is `KeyMap`; `RelationMappedBy` is gone.** An unknown entity class is `Type<object>`.
- **`generate:from-db` writes an inverse relation as `mappedBy`**, where it wrote a `references` string that did not compile.

## [0.57.0] - 2026-09-11

- **Breaking: a to-many `$populate` and `$count` are read in the parent's statement**, so a read is one snapshot and adds no id it did not select. MySQL needs 8.0.14+, SQLite 3.44+.
- **Relations and `$count` work in `findManyStream`, under a to-one and beside `$distinct` or a raw `$select`**, and `@AfterLoad` runs on every populated row, children first.
- **A populated relation takes a raw `$select` aliased with `.as()`**, and its types refuse `$count` and `$candidates`, as the runtime did.
- **Five relation bugs are fixed**: an unmatched to-one showing beside a computed field, a relation excluding every field throwing, a renamed column beside a join, a self-relation filter, and MongoDB's `withDeleted()` reaching joined rows.
- **D1, libSQL and Turso split calls past their function-argument cap**, so wide relation rows and many-key JSON updates run.
- **Breaking: each table reads under its name, relation key or join path**, which a `raw()` naming a related table must use; `QueryContext.nextAlias` is now `claimAlias(name)`.
- **Removed: `QuerySelectOptions`, `QueryStreamProjected` (use `QueryProjected`), `selectFields` and `MongoDialect.relationStages`.**
- **Every foreign key is indexed** unless an index leads with it (`index: false` opts out), so the next migration adds them; `ifNotExists` skips existing indexes too.
- **Breaking: migrations refuse an index `type` or feature their engine lacks**, instead of SQL it rejects; MySQL/MariaDB `btree`/`hash` and CockroachDB `hnsw` with `m`/`efConstruction` now migrate.
- **Breaking: the migrator takes a `MigratorDialect`** (`AbstractSqlDialect | MongoDialect`) where it took any `AbstractDialect`: `Migrator`, `Config.pool` and the schema generator factories.

## [0.56.0] - 2026-09-10

- **`$text` without `$fields` searches the entity's fulltext index.** On SQL, an entity with no such index, or more than one, has to name `$fields`.
- **Postgres migrations refuse a `fulltext` index**, which Postgres does not have, instead of generating invalid SQL.
- **`drift:check` reports a foreign key whose `ON DELETE` or `ON UPDATE` changed**.

## [0.55.0] - 2026-09-10

- **Breaking: the empty driver subclasses are gone.** Pools build `PostgresDialect`, `MySqlDialect` and `MongoDialect` themselves; `CrdbQuerier`/`NeonQuerier` are `PgQuerier`, `LibsqlQuerier`/`TursoQuerier` are `HranaQuerier`. `npx uql-codemod` names each.
- **Breaking: a custom `AbstractPoolQuerier` takes its connection first**, like every driver's querier, and `AbstractPgQuerierPool`/`AbstractHranaQuerierPool` build their querier themselves.
- **Breaking: `BunSqlQuerier` no longer exposes `sql`**, the pool's client, which ran outside the querier's transaction. Raw access is `pool.sql`.
- **Breaking: a BIGINT past 2^53 reads back as its exact text**, where most drivers rounded it silently; the SQLite drivers keep their own answer.
- **A `bigint` past 2^53 is written exactly** on every driver, where each bound a rounded number; D1, whose API refuses one, gets its text.
- **A dropped SQL Server connection no longer crashes the process**, and every pool's idle-connection error goes through its own `logger`.
- **SQL Server streams with backpressure**, through the driver's own stream, where a slow loop held every row the server sent.
- **A JSON path's `$in` or `$nin` that is not an array is refused**, as a column's already was, instead of matching nothing.
- **SQLite through `uql-orm/bunSql` is deprecated** for `Sqlite3QuerierPool`, which runs on `bun:sqlite` under Bun; it now opens in WAL like the others.

## [0.54.0] - 2026-09-10

- **Breaking: `virtual` and `raw('sql')` are gone**, deprecated since 0.46.0 and 0.40.0. `npx uql-codemod` rewrites both.
- **An `after*` hook sees the row as written**: the generated id and every `onInsert`/`onUpdate` value. Global listeners get the same rows.
- **Every upsert reports every id, in payload order.** What a statement cannot place is read back by the conflict columns: MySQL, CockroachDB, SQL Server and MongoDB, and mixed-shape batches everywhere.
- **A composite key reports a column its `onInsert` filled**, which came back `undefined` from inserts and saves.

## [0.53.0] - 2026-09-10

- **Breaking: `$where` takes a map and nothing else**, so TypeScript reports a wrong value on its own key. Ids are `{ id: [1, 2] }`, a bare `raw()` goes in `$and`; HTTP answers 400 otherwise.
- **Breaking: `QueryWhereMap` is now `QueryWhere`**, and `QueryWhereFieldMap`, `augmentWhere` and `buildQueryWhereAsMap` are gone; `npx uql-codemod` names what replaces each.
- **A MongoDB `raw()` inside `$and`/`$or` is refused with its error** instead of recursing until the stack gave out.
- **Vector search on MSSQL** through `VECTOR_DISTANCE`: cosine, euclidean (`l2`) and dot (`inner`), exact rather than indexed. Needs SQL Server 2025 and a declared `dimensions`.
- **MSSQL `sync()` alters an existing table**: it adds plain, computed and key columns, and no longer re-alters an identity key it read back as unique.
- **MSSQL migrations rename, drop and retype columns**: renames through `sp_rename`, and the default, `CHECK` and `UNIQUE` the server names itself dropped first rather than blocking the statement.
- **A key column is declared `NOT NULL`**, which SQLite does not imply for a composite or non-integer key, so one could store NULL.
- **An enum column with a default is created on MariaDB.** Its `CHECK` came before the `DEFAULT`, which MariaDB's grammar refuses; the `CHECK` now comes last.

## [0.52.0] - 2026-09-09

- **Microsoft SQL Server 2017+, through `uql-orm/mssql` and the `mssql` driver.** `$regex` needs a 2025 server at compatibility level 170; `$text` and vector search are refused.
- **`findManyStream` streams for real on `bunSql` (Postgres, CockroachDB) and PGlite.** Both clients expose no cursor, so the rows page through a server-side `DECLARE`/`FETCH` instead of buffering the whole result.
- **A `bun:sql` URL for an engine Bun cannot dial is refused by the pool.** An `mssql://` connection string read as Postgres and failed on the first statement.
- **Breaking: `BunSqlPostgresDialect`, `BunSqlCockroachDialect` and `BunSqliteDialect` are gone.** The pool builds the engine's own dialect with the wire driver's capabilities; `POSTGRES_WIRE_DRIVER_CAPABILITIES` now carries both `nativeArrays: false` and `explicitJsonCast: true`.
- **Breaking: `defaultStringAsText` is now the three-way `stringSizing`**, joined by `supportsUnsigned` and `multipleCascadePaths`. Only a hand-written dialect declares them.

## [0.51.0] - 2026-09-09

- **Breaking: an upsert reports the entity's id, not the driver's result.** `upsertOne` returns `{ id, changes, created }` and `upsertMany` `{ ids, changes }`, ids in payload order. `firstId` is gone from both; `run()` keeps it.
- **A MongoDB upsert says which rows it inserted.** `bulkWrite` keys its ids by operation index and they were flattened into a dense list, so nothing tied them back to a row.

## [0.50.0] - 2026-09-09

- **All four write methods report an id in one shape.** `WrittenId` is the column's value on a single key and the key map on a composite, so `saveOne` no longer hands back a union of both.
- **Breaking: a composite insert reports its key** where it reported `undefined`. No column holds it, so the querier names the row from the payload, as a save already did.

## [0.49.0] - 2026-09-09

- **Breaking: a key not called `id`, `_id` or `uuid` needs the `idKey` brand naming it**, a composite always. `@Id` refuses one without it, where before the key resolved to any column and `findOneById` took its value. `npx uql-codemod` writes the brand.

## [0.48.0] - 2026-09-09

**Breaking: `saveOne`/`saveMany` upsert instead of guessing.** A row naming its key upserts on it, so a stale id writes it. Both return `EntityId`, so a composite comes back as its key map - `insertOne`/`insertMany` keep `IdValue` - and ids come back in payload order. A save fires the new `@BeforeUpsert`/`@AfterUpsert` pair, not the update one; move hooks that ran on a save.

- **Breaking: MongoDB stores and returns the key you declare.** A supplied id is the document's `_id`; a minted one reads back as a hex string, not an `ObjectId`. `@Id({ type: Number })` with no `onInsert` is refused, since MongoDB mints only an `ObjectId`.
- **`@BeforeUpsert`/`@AfterUpsert` hooks**, fired by `upsertOne`/`upsertMany`, which ran none at all, and by a save that names its key.
- **`upsertMany` writes what each row asked for**, and splits by the dialect's bind budget like `insertMany`.
- **A batch mixing supplied and generated ids reports every id on MySQL**, so a cascade no longer writes a null foreign key.
- **A one-to-one update replaces its child** instead of leaving the old row for `$populate` to choose between.
- **A computed field's expression is table-qualified**, so one opening a subquery reads the outer column rather than the inner table's.

## [0.47.1] - 2026-09-09

- **`$not` and `$nor` now work at the root of a `$where` on MongoDB.** Both threw `path $not does not exist`; every SQL dialect negated the group.
- **`{ $and: [] }` no longer breaks the query.** An empty group left SQL a dangling `WHERE` and MongoDB an operator it rejects; it now constrains nothing.
- **A populated to-many no longer breaks on an id like `__proto__`.** It threw `push is not a function`, and the relation's `_count` read back as an object.
- **Populating a relation allocates a third less.** A page of 50 parents with 200 children drops from 245 KB to 190 KB.

## [0.47.0] - 2026-09-09

- **`$limit`/`$skip` inside a to-many `$populate` are now per parent.** They capped the whole page, so a parent that had children could come back with `[]`. One bounded subquery per parent, on every engine.
- **A many-to-many `$populate` can order and page.** `$sort`, `$limit`, `$skip` and `$distinct` reached the target's join, which rejects all four, so any of them threw.
- **Postgres, CockroachDB, PGlite and Neon page a relation with `LATERAL`**, so the cost stays flat as the parent page grows: 3.5x faster than the portable shape at 100 parents, 8.3x at 500.
- **MongoDB reads a bounded relation in one round trip**, through `$unionWith` rather than a query per parent - around 6x faster on a page of 50 or more.
- **Bun SQL now enforces foreign keys on SQLite.** `bun:sql` leaves the pragma off, so declared constraints were decorative: dangling rows inserted, `ON DELETE CASCADE` left orphans.
- **`BunSqlCockroachDialect` is now exported** from `uql-orm/bunSql`, like its Postgres and SQLite siblings.

## [0.46.0] - 2026-09-08

- **`@Field({ computed, stored })` declares a column the database computes.** Unstored it is spliced into each statement, as `virtual` was; `stored: true` makes it a `GENERATED ALWAYS AS (...) STORED` column, indexable like any other. SQLite accepts one only in a `CREATE TABLE`.
- **`virtual` is deprecated**, renamed to `computed`. Both live for one release, giving both throws, and `npx uql-codemod` rewrites it.
- **A migration-builder column now emits everything it declares.** Its foreign key, index and comment were dropped unless `createTable` lifted them. New: `.computed()` and `.enum()`.
- **`$sort` on a computed field works without selecting it.** It ordered by the output alias, which only exists when the field is in `$select`; now every clause writes the expression.
- **A generated entity keeps its column comments.** `generate:entities` wrote them only into a JSDoc, so the next sync dropped every one.
- **`introspect(tables?)` reads just the tables you name**, instead of every relation in the database.
- **Breaking:** `DialectFeatures.columnComment` is `commentSyntax: 'inline' | 'statement' | 'none'`. Read as a boolean, Postgres landed on SQLite's branch and lost every comment.

## [0.45.1] - 2026-09-08

- An enum column added to an existing table is now constrained.

## [0.45.0] - 2026-09-08

- **A sync now applies foreign keys.** Adding one, dropping one or changing its `onDelete` reaches the database. Not on SQLite, which cannot alter one.
- **`SET DEFAULT` reads back from the db.** It looked like `NO ACTION`, so every sync offered to fix a constraint that was already right.
- **Breaking: a generated key is spelled from the type it declares**, so a foreign key can match it. MySQL and MariaDB keys lose `UNSIGNED`; a sync alters them under `safe: false`.
- **Breaking: a key filled by `onInsert` is no longer auto-increment.** The schema and the insert path asked separately and disagreed.
- **Breaking: `serial`, `bigserial` and `smallserial` are gone as `columnType`.** Declare the width: `@Id({ type: Number })` is a big integer, `columnType: 'int'` a four-byte one.
- **Breaking:** `TableForeignKeyDefinition` is gone. `ForeignKeySchema` describes every foreign key, its target under `references: { table, columns }`.

## [0.44.0] - 2026-09-07

**A schema can be defined while the process runs** - a CMS content type an admin creates, a tenant whose columns are a row in a table. Register the columns as they arrive, with the SQL type each one stores (`type: 'text'`), then `sync({ entity })` gives it a table without reading the whole catalogue. See [Runtime Schemas](https://uql-orm.dev/entities/runtime).

- `removeEntity(entity)` forgets a content type.
- `uql-migrate types` writes a `.d.ts` for the registered entities, so one definition feeds both the database and the compiler.
- **A naming strategy no longer rewrites a name you wrote.** `@Entity({ name: 'UserProfile' })` on `class UserProfile` was snake-cased like a default.
- `entityPath` names an HTTP route, on the handler and the browser client alike, for a build that minifies class names.
- A column typed as every scalar at once - what a shape known only at runtime has - keeps every operator, instead of narrowing to the equality a boolean and a blob share.
- **Breaking:** one pair applies the schema - `sync(options)` and `planSync(options)`. `autoSync()`, `syncForce()` and `syncEntity(e)` are now `sync()`, `sync({ force: true })` and `sync({ entity: e })`. `--dry-run` is honored beside `--force`, which it used to ignore.

## [0.43.0] - 2026-09-07

**An option a column cannot use is now an error** rather than silently ignored: `autoIncrement` on a string, `length` on a number, `index` on a `virtual` field, `nullable: true` on a key. `defaultValue` must be the value the column holds, except on a JSON column, which takes the SQL literal it stores.

- **Drift no longer misses a mismatched column.** `VARCHAR` against `TEXT` read as a match on Postgres, and a change that truncates - `TEXT` to `VARCHAR(50)`, a dropped timezone - was reported as safe.
- **Registering onto a decorated class keeps its table.** A later `defineEntity` used to retarget `@Entity({ name, schema })` at the class name in the default schema.
- **A field or relation added to an entity already queried now works**: the relation used to throw, the field to come back raw.
- `$select` on an entity typed with an index signature keeps its columns, instead of returning `{}`.
- A generated entity types a blob column as `Uint8Array`, so it compiles without `@types/node`.

## [0.42.1] - 2026-09-05

**A migration can change a primary key.** A second `@Id` on an entity already in the database used to add the column and leave the key alone, so the table kept enforcing uniqueness on one column while uql addressed rows by two:

```sql
ALTER TABLE "Member" DROP CONSTRAINT "Member_pkey";
ALTER TABLE "Member" ADD CONSTRAINT "Member__userId_groupId_pk" PRIMARY KEY ("userId", "groupId");
```

Keys are compared by their columns, so no existing database is rewritten. SQLite refuses by name. Drift reports the change too, which it could not see before.

**Constraint names read `<table>__<columns>_<kind>`**: `Order__total_idx`, `User__email_uk`. The separator is doubled because Postgres and SQLite name these per database rather than per table, so `user` + `profile_id` and `user_profile` + `id` used to collide. Nothing existing is renamed - an index is recognised by the columns it covers.

**A sync no longer asks for work it cannot do.** MariaDB rewrote every nullable column on every sync, reading the `null` default it reports as different from no default at all. Auto-increment is no longer compared, since no DDL here changes it.

**Composite key fixes:** upserts work on one; a migration no longer makes each key column a serial; MongoDB refuses a many-to-one at a composite target; `$count` reads each parent through the relation's own join columns.

- **Breaking:** every key is now declared as a table constraint, so the dialect's `serialPrimaryKey` is `serialType` (the type alone) plus `serialDeclaresPrimaryKey` for SQLite, whose `AUTOINCREMENT` must stay inline. `ColumnSchema.declaresPrimaryKey` is gone, and `SchemaDiff` gained `primaryKey`.

## [0.42.0] - 2026-09-04

**Composite primary keys.** A second `@Id` makes the key composite, and a row is addressed by an object naming every key:

```ts
@Id({ type: Number }) userId?: number;
@Id({ type: Number }) groupId?: number;

await pool.deleteOneById(Membership, { userId: 1, groupId: 2 });
```

- Composite `PRIMARY KEY` and foreign-key DDL, with each column typed from the key it points at.
- Every key is taken wherever a row is named: inserts, by-id addressing, relation loading, relation filtering, `$count`, and the settled set a paged write names its rows by.
- An insert reports `undefined` for a composite id, as a key the driver cannot report already does; `idOf(meta, row)` names such a row. `saveMany`, saving a relation, MongoDB and the HTTP `/:id` route refuse one by name.
- An array `$where` of maps is now the OR it was documented to be.
- **Breaking:** `EntityMeta.id` is now `ids`; `typeFromReference` moved to the new `FieldMeta`; the insert and save methods return `IdValue<E> | undefined`, which they already did on MySQL. A second `@Id` composes the key rather than replacing the first.

**A typo'd `@Field` / `@Id` option is now a compile error.** `@Field({ nulable: true })` used to compile and be ignored, because TypeScript skips excess-property checking on a naked type parameter.

## [0.41.1] - 2026-09-04

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

Skip `0.41.0`: it shipped a stale build. `prepack` now builds.

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
- **`$pull`** removes every element equal to a value, on every SQL dialect and MongoDB. Operators apply in a fixed order - `$pull` -> `$set` -> `$push` -> `$unset` - so `$pull` and `$push` on one key atomically replace an element.
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
