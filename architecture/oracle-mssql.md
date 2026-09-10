# SQL Server and Oracle

Design for two engines the [roadmap](roadmap.md) does not yet name. **SQL Server first, Oracle second**, behind one shared family base.

**SQL Server has shipped.** What follows describes what was built; the Oracle half is still design.

Two conclusions the first draft of this design got wrong, both corrected by reading what shipped elsewhere (`../mikro-orm`, `../knex`, `../kysely`, `../typeorm`, `../sequelize`):

- **R5 is not a prerequisite.** Oracle's generated ids ride in the values array.
- **Only one new knob is needed**, not four. A family base and a column collation absorb the rest.

## Why these two, and in that order

Market share answers the wrong question. What matters is whether a would-be adopter is _blocked_, and the two engines diverge sharply on that.

|                                                                   | SQL Server                                          | Oracle                             |
| :---------------------------------------------------------------- | :-------------------------------------------------- | :--------------------------------- |
| Developers using it ([SO 2025](https://survey.stackoverflow.co/)) | 25.3%                                               | 10.6%                              |
| Node driver downloads/month                                       | 17.4M (`tedious`)                                   | 3.5M (`oracledb`)                  |
| Shipped by                                                        | TypeORM, Sequelize, Knex, MikroORM, Prisma, Drizzle | TypeORM, Sequelize, Knex, MikroORM |
| UQL's position without it                                         | the only serious TS ORM missing it                  | in company with Prisma and Drizzle |

For reference, `pg` is 190M/month and `mariadb` - which UQL already supports - is 3.0M. MariaDB was nearly free because it is a MySQL fork sharing `MysqlLikeSqlDialect`; Oracle is a dialect from nothing. Same audience size, an order of magnitude apart in cost.

So: SQL Server is a gap that loses comparisons and blocks a real population - the .NET shop writing new Node services against a database it already has. Oracle is a differentiator; Prisma has had [an open request since June 2020](https://github.com/prisma/prisma/issues/2853).

**Version floors, stated once.** SQL Server **2017+** - derived, not chosen: `STRING_AGG` is the newest thing the dialect emits, and everything else is 2016 or older. Oracle **23ai and up**, which Oracle [renamed AI Database 26ai](https://mikedietrichde.com/2025/10/14/oracle-ai-database-26ai-replaces-oracle-database-23ai/) in October 2025 while keeping the internal `23.x` version. The Oracle floor is what keeps this design small: 23ai brought multi-row `VALUES`, native `BOOLEAN`, a native `JSON` type with `JSON_TRANSFORM`, and `VECTOR_DISTANCE`. Below it each of those needs a second code path - `INSERT ALL ... SELECT FROM dual`, `NUMBER(1)`, CLOB JSON - which is what TypeORM carries and why its Oracle driver is 4,700 lines.

## What this costs, measured

Lines of dialect/driver/introspection code in the sibling clones:

| ORM          | SQL Server |  Oracle |
| :----------- | ---------: | ------: |
| Kysely       |      1,324 |    none |
| Sequelize v7 |    1,520\* | 1,309\* |
| Knex         |      2,036 |   2,520 |
| MikroORM     |      2,498 |   3,577 |
| TypeORM      |     ~6,400 |  ~4,700 |

\* excludes the shared abstract query generator in core.

The shape is consistent: **introspection and DDL are the bulk, not the query builder.** MikroORM's `MsSqlSchemaHelper` is 1,164 lines against 269 for its query builder; `OracleSchemaHelper` is 1,031 against 309. Kysely gets away with 127 lines of query compiler only because it never owns `$limit` - the user writes `.top()` or `.offset().fetch()` themselves. UQL owns it, so UQL pays where Kysely does not.

Budget **~1,000 lines per engine**: ~400 dialect, ~350 introspector, ~150 querier and pool, ~60 index DDL. Under everyone but Kysely, because `AbstractSqlDialect` already factors what those ORMs restate.

## The shape: a third family base

`PgLikeSqlDialect` and `MysqlLikeSqlDialect` each hold what one family spells differently. These two engines share enough to earn the same treatment, and doing it as a base rather than as knobs is what keeps the core untouched:

```
AbstractSqlDialect
├── PgLikeSqlDialect       postgres, cockroachdb, (pglite, neon, ...)
├── MysqlLikeSqlDialect    mysql, mariadb
├── MergeSqlDialect        mssql, oracle          <- new
└── SqliteDialect          sqlite, (libsql, turso, d1)
```

`MergeSqlDialect` carries, for both:

- **`pager()`** - `OFFSET m ROWS FETCH NEXT n ROWS ONLY`. An override, exactly as SQLite and the MySQL family already override it. **No knob.**
- **`upsert()`** - one `MERGE`, below.
- `escapeIdChar = '"'`, `maxIdentifierLength = 128`.

> The name is the one open question. It names the more distinctive of the two shared clauses; `StandardSqlDialect` would name the fact that both spell paging and upsert the way the SQL standard does, where MySQL and Postgres each predate it.

## The seams

Five places in the core assume MySQL- or Postgres-shaped SQL. Each is small; none can be reached from a subclass.

### 1. The pager clause is hardcoded in the specs

The dialect side is just `pager()`, already overridable. The cost is in the tests: **46 hardcoded `LIMIT` assertions** in [`abstractSqlDialect-spec.ts`](../packages/uql-orm/src/dialect/abstractSqlDialect-spec.ts) plus 14 across the family and vector specs. `expected$skipClause()` is already the hook for one of them; generalize it to `expectedPager({ limit, skip })` and the change is mechanical.

**One design decision inside it.** SQL Server rejects `OFFSET` without an `ORDER BY`. Every other ORM works around that with a _second_ clause - `TOP (n)` in the select list when there is a limit and no offset, `OFFSET/FETCH` otherwise. Knex, MikroORM and Kysely all do it that way, which needs a select-list hook on top of the pager one.

**UQL should not.** Emit `OFFSET 0 ROWS FETCH NEXT n ROWS ONLY` always and synthesize `ORDER BY (SELECT NULL)` when the query carries no `$sort`. One override instead of two, and it is the only way `$skip` without `$sort` keeps working: MikroORM throws `Order by clause is required for pagination` there, knex emits SQL the server rejects. A query that runs on four engines must not throw on the fifth.

> Verify on the container before committing: confirm the optimizer introduces no sort operator for a constant `ORDER BY`. If it does, `TOP` comes back and so does the second hook.

### 2. The returning clause is a suffix

[`abstractSqlDialect.ts:1414`](../packages/uql-orm/src/dialect/abstractSqlDialect.ts#L1414) appends `RETURNING` after the whole statement. SQL Server's `OUTPUT INSERTED."id"` sits between the column list and `VALUES` - TypeORM splices it at exactly that point, and so must this. **The one new knob:**

```ts
readonly returningPosition: 'suffix' | 'after-target' = 'suffix';
```

`appendInsertValues` takes the clause and places it by the knob; `insert` passes what `returningId` already builds. Two lines in the base. A knob rather than a hook because it makes the coordination impossible to get wrong - one concept decides where one string goes, instead of two overrides that must agree.

**Oracle keeps the suffix.** `RETURNING "id" INTO :out_id` _is_ trailing.

### 3. Oracle's generated ids ride in the values array

`internalRun(sql, values)` ([`abstractSqlQuerier.ts:153`](../packages/uql-orm/src/querier/abstractSqlQuerier.ts#L153)) has nowhere to put an out-bind, and the querier never sees the entity. That looked like it needed R5 - a compiled statement object with somewhere to hang bind metadata.

It does not. **MikroORM's `OracleDriver` builds an `out_<column>` bind map, pushes it as the final entry of the params array marked `__outBindings`, and `OracleConnection` strips that entry and hands it to `oracledb` as bind options** - then reads `result.outBinds` back, dropping the prefix, into rows. node-oracledb [always returns DML-RETURNING binds as arrays](https://node-oracledb.readthedocs.io/en/latest/user_guide/bind.html), so one path covers single and multi-row inserts.

Entirely containable in `OracleDialect` + `OracleQuerier`, no core contract change, and Oracle keeps `insertIdSource: 'returning'` with the whole existing id-reporting path. R5 stays on the roadmap for batching, where it belongs.

Knex's Oracle does the older, worse thing - `RETURNING ROWID INTO :out` and a second query to resolve it. Do not copy that.

### 4. A regex predicate is an operator

[`abstractSqlDialect.ts:2228`](../packages/uql-orm/src/dialect/abstractSqlDialect.ts#L2228) is a `regexpOp` getter spliced as `col <op> ?`. Oracle spells it `REGEXP_LIKE(col, ?)` and SQL Server 2025 the same: a function, not an operator. Widen to a method:

```ts
protected regexCondition(operand: string, placeholder: string): string
```

SQL Server 2019 and 2022 have no regex at all and throw, the way `appendTextSearch` already does.

### 5. `SQL_TO_CANONICAL` is one global name-to-type map

[`canonicalType.ts:26`](../packages/uql-orm/src/schema/canonicalType.ts#L26) parses a type name without knowing which engine printed it. Already a latent conflation - `bit` maps to boolean, though it is a bit string on Postgres - and the new engines make it wrong rather than sloppy:

- SQL Server `float` is 8 bytes and `real` is 4; the table has the sizes the other way round.
- Oracle `NUMBER` is integer, decimal or float depending on its scale.
- `datetime2`, `datetimeoffset`, `uniqueidentifier`, `varchar2`, `clob`, `raw` are absent entirely.

A per-dialect override map layered over the shared one, consulted by `canonicalColumnType`. Without it introspection silently mis-types columns and every diff churns.

### Also: the migrator's introspector switch

[`migrator.ts:116`](../packages/uql-orm/src/migrate/migrator.ts#L116) hard-codes a `switch` over every introspector, so `./migrate` - budget 50.4 KB gzipped - would carry two more engines for every user who never touches them. `createSchemaGeneratorAsync` already sets the dynamic-import precedent. Make it a registry keyed by `dialectName`.

## What is deliberately _not_ a seam

Two problems that look like they need query-side knobs and do not. Both were in the first draft; removing them is the main simplification.

**Case sensitivity follows the database collation**, case-insensitive by default, so `$eq` matches `'ABC'` against `'abc'` - as on MySQL and MariaDB, whose defaults are case-insensitive too. uql forces a collation on neither: it takes the database's own, and a forced one would put a `COLLATE` clause into every string column's type for the canonical parser to learn. `$regex` is case-sensitive regardless, `REGEXP_LIKE`'s default.

**Unicode is a DDL decision too.** `VARCHAR` on SQL Server is a codepage type; only `NVARCHAR` holds Unicode. MikroORM carries a whole `UnicodeStringType` (59 lines plus a `validateMetadata` pass) because it exposes the `varchar`/`nvarchar` choice to users. UQL does not, so it is: map `string` to `NVARCHAR` in the type map, and prefix inlined literals with `N` in `escape()`. Bound parameters need nothing - tedious binds JS strings as `NVarChar`. Get it wrong and non-ASCII data is destroyed on write with no error, so it needs a test with a non-ASCII fixture, not just a review.

## Knobs, per engine

Existing knobs get values; `returningPosition` is the only new one.

|                           | SQL Server                                                                     | Oracle                                        |
| :------------------------ | :----------------------------------------------------------------------------- | :-------------------------------------------- |
| `escapeIdChar`            | `"`                                                                            | `"`                                           |
| `returningPosition`       | `after-target`                                                                 | `suffix`                                      |
| `insertIdSource`          | `returning`                                                                    | `returning`, via out-binds                    |
| `autoIncrementSuffix`     | `IDENTITY(1,1)`                                                                | `GENERATED BY DEFAULT AS IDENTITY`            |
| `booleanLiteral`          | `integer` (`BIT`)                                                              | `native` (23ai)                               |
| `beginTransactionCommand` | `BEGIN TRANSACTION`, sent through the driver's `Transaction` (`internalBegin`) | none - `internalBegin` turns `autoCommit` off |
| `isolationLevelStrategy`  | `set-before`                                                                   | `set-before`                                  |
| `alterColumnSyntax`       | `ALTER COLUMN`, type and nullability alone; the default is a constraint        | `MODIFY`                                      |
| `commentSyntax`           | `none` - extended properties are not comments                                  | `statement`                                   |
| `dropTableCascade`        | false                                                                          | true (`CASCADE CONSTRAINTS`)                  |
| `supportsRowLocks`        | true, as table hints                                                           | true, `FOR UPDATE` verbatim                   |
| `maxBindValues`           | **2100** - [a hard server limit](https://github.com/yiisoft/yii2/issues/10371) | 65535                                         |
| `schemas`                 | true, default `dbo`                                                            | true                                          |
| `regexCondition`          | throws below 2025                                                              | `REGEXP_LIKE`                                 |
| `$text`                   | throws - needs a full-text catalogue                                           | throws - needs a CONTEXT index                |

**Identifiers stay `"`-quoted on both.** MikroORM and knex both chose `[...]` for SQL Server, which would make `escapeIdChar` a pair rather than a char and break the ~50 spec assertions that read it. `"` is ANSI, Kysely uses it, and [tedious sets `enableQuotedIdentifier: true` by default](https://www.jsdocs.io/package/tedious). On Oracle, quoting is what preserves `createdAt` from being folded to `CREATEDAT` - the inlined Kysely compiler in MikroORM's Oracle package drops quoting entirely and pays for it with uppercase row keys. UQL already asks Postgres users to live with quoted camelCase; this is the same trade.

## Upsert: one `MERGE`, with `HOLDLOCK`

The one real piece of shared SQL, and the reason `MergeSqlDialect` exists:

```sql
MERGE INTO "Item" WITH (HOLDLOCK) USING (VALUES (?, ?)) AS s ("id", "name") ON "Item"."id" = s."id"
WHEN NOT MATCHED THEN INSERT ("id", "name") VALUES (s."id", s."name")
WHEN MATCHED THEN UPDATE SET "name" = s."name";
```

Oracle differs only in the source - `USING (SELECT ? "id", ? "name" FROM dual) s`, and 23ai [dropped the need for `dual`](https://oracle-base.com/articles/23/table-values-constructor-23) so a values constructor works there too - and in not needing the hint or the terminating semicolon.

**`WITH (HOLDLOCK)` is not optional.** `MERGE` takes an update key lock but [releases it before the insert](https://weblogs.sqlteam.com/dang/2009/01/31/upsert-race-condition-with-merge/), so two concurrent upserts of the same key raise a duplicate-key error. MikroORM's `compileUpsert` emits a bare `merge into`; that is a live race in a shipped ORM, and the kind of thing `saveMany` under load finds in production rather than in a test.

## Locking

Oracle inherits `appendLock` unchanged - `FOR UPDATE OF ... SKIP LOCKED / NOWAIT` is verbatim what the base emits.

SQL Server has no `FOR UPDATE`. It is a table hint immediately after the table reference: `WITH (UPDLOCK, ROWLOCK)`, plus `READPAST` for `$lock: 'skip'` and `NOWAIT` for `'nowait'`. `tableRef()` is the hook but does not see the query; threading `q` into it is a three-call-site change. Worth doing - `$lock` is a headline feature and shipping with `supportsRowLocks: false` would be a visible hole.

## The things that will fail silently

Ordered by how quietly. Each needs a test before the feature it belongs to.

1. **`JSON_VALUE` returns `NULL` past 4000 characters.** Its return type is `nvarchar(4000)` and lax mode - the default - [fails silently rather than erroring](https://database.guide/how-to-fix-json_value-returns-null-with-long-strings-sql-server/). So `getJsonPathScalarExpr` cannot be `JSON_VALUE` on 2019/2022; it has to read through `OPENJSON`, which returns `nvarchar(max)`. On 2025's native `json` type, `RETURNING nvarchar(max)` is available - but EF Core found it crashes the Azure SQL engine, so `OPENJSON` stays the portable answer.
2. **`''` is `NULL` on Oracle.** Nothing can fix it. Needs an overridable expectation in the shared suites - the `expectedMixedBatchIds` pattern - and a line in the docs.
3. **`OUTPUT` is rejected on a table with triggers** ("cannot have any enabled triggers if the statement contains an OUTPUT clause without INTO") and on some cascade-FK shapes. Knex and MikroORM _independently_ arrived at the same workaround: `SELECT TOP(0) ... INTO #out ...; INSERT ... OUTPUT ... INTO #out ...; SELECT ... FROM #out; DROP TABLE #out`. Four statements. Ship without it, detect the error, add it behind a flag - do not pretend the plain form always works.
4. **`SET IDENTITY_INSERT ON/OFF`** must wrap any insert writing an explicit key. UQL's own fixtures do this constantly, so it surfaces on the first integration run rather than in production. MikroORM and knex both gate it behind a flag.
5. **Multiple cascade paths.** Both engines refuse an FK graph with two cascade routes to one table (SQL Server error 1785); `MsSqlPlatform` and `OraclePlatform` both answer `supportsMultipleCascadePaths(): false`. uql's `defaultForeignKeyAction` is `NO ACTION` everywhere already, so only a cascade the entity declares can meet this, and the server refuses it by name - where downgrading it would change what a delete does without a word.
6. **Row-value comparison is unsupported on SQL Server.** Only matters for the roadmap's cursor pagination, which already plans an OR-chain fallback. Noted there now so it is not discovered later.
7. **Default NULL sort position.** Oracle sorts NULLs last ascending, with Postgres; SQL Server sorts them first, with MySQL and SQLite. Documentation, not code - UQL exposes no query-level nulls ordering, and this inconsistency already exists between Postgres and MySQL.

Three more that cost nothing but should be written down: Oracle cannot run multiple statements in one `execute` (`splitSqlStatements` already handles it); SQL Server's `TRUNCATE` needs elevated rights and fails against FKs, so it is `DELETE` plus a `DBCC CHECKIDENT` reseed, which is what MikroORM emits; and node-mssql infers bind types from JS values, so a `null` with no column context binds as `NVarChar` and can be rejected - the pool should declare types for nullable columns rather than trust inference.

## Testing

**`ALTER DATABASE ... SET READ_COMMITTED_SNAPSHOT ON` in the container init.** SQL Server's default `READ COMMITTED` takes shared read locks where Postgres and Oracle use MVCC, so a concurrent ORM workload deadlocks on patterns that never deadlock elsewhere. Snapshot isolation is the standard fix, it is one line of init SQL beside `docker/init-pg.sql`, and it is also the advice users need - so it belongs in the docs, not only in the test rig.

Engine differences inside the suites use the existing idiom: a capability flag on the test-db descriptor plus `it.skipIf(db.noForeignKeyAlter)`, as [`migrator-sync.test.ts`](../packages/uql-orm/src/migrate/migrator-sync.test.ts) already does. No name checks.

Containers:

- **Oracle**: `gvenzl/oracle-free`, [natively multi-arch since 23.5](https://www.geraldonit.com/oracle-database-free-for-arm-and-multi-platform-images-now-available/), healthy in ~45s.
- **SQL Server**: `mcr.microsoft.com/mssql/server:2025-latest`. There is still **no arm64 image**, so this runs under emulation on Apple Silicon; the AVX requirement that stopped 2025 starting under Docker Desktop's Rosetta layer was lifted by the engine's CU1, and it is healthy in about twenty seconds. The image runs nothing from a volume on startup, so the database and its snapshot isolation are created by the healthcheck itself - idempotently, and there rather than in a one-shot init container because `docker compose up --wait` returns while such a container is still running, which would let CI start testing before the database existed.

**The suite runs with every other engine's, in `bun run test`.** The first draft of this design put it behind a separate script on the assumption the container was too slow for the everyday gate; measured, it is healthy in 12 seconds - no worse than MySQL or Postgres - and the 307 cases run in 5.5. What is actually different about it is worth knowing but not worth a second entry point: the image is ~2.4GB, roughly double the next largest, it is the only one with no arm64 build, and it is the only one needing a second container to create its database. A suite outside the gate is a suite that stops being run.

## Vectors

SQL Server 2025's `VECTOR_DISTANCE` is taken, as exact search - see below. Oracle 23ai's takes the metric last and unquoted, `VECTOR_DISTANCE(a, b, DOT)`, beside a function per metric: `COSINE_DISTANCE`, `L2_DISTANCE`, `L1_DISTANCE`.

`estimatedCount` ships on SQL Server (`sys.dm_db_partition_stats`, live) and not on Oracle (`USER_TABLES.NUM_ROWS` is stale until stats are gathered, and a confidently wrong number is worse than the refusal the base already throws).

## Build order

| Phase | Work                                                                          | State    |
| :---- | :---------------------------------------------------------------------------- | :------- |
| **0** | The five seams, the introspector registry, `MergeSqlDialect`                  | shipped  |
| **1** | SQL Server: dialect, introspector, querier and pool, specs, integration suite | shipped  |
| **2** | Oracle: the same, plus the out-bind path and the `''`-is-`NULL` expectations  | designed |

Four of Phase 0's six items - the pager spec hook, the type-map split, `regexCondition`, the introspector registry - are cleanups the codebase wanted whether or not either engine was built. Only `returningPosition` and `MergeSqlDialect` exist solely to serve them.

### What Phase 0 turned out to cost

The pager hook was the whole of it: 54 assertions across five spec files carried a `LIMIT` in their expected SQL, and the two dialects whose paging already differs each carried an override of the one case that showed it. Both overrides are gone, replaced by one `pgr()` helper that asks the dialect.

The type-table collapse found two things the seams had not predicted. `defaultStringAsText` was a boolean that could not describe SQLite, so SQLite carried a second check by name to escape the branch the boolean put it in - it is now the three-way `stringSizing`, and `canonicalType.ts` has no `dialectName` checks left. And `jsonScalarParam` bound its value against a hardcoded `?`, which held only because the two dialects reaching it both spell one that way; it asks the dialect now.

`supportsUnsigned` landed as an `EngineFeatures` field rather than the prose rule this design first wrote it as.

### What the live suite settled

The shared integration suite runs against SQL Server 2025 and **all 307 cases pass**. Four things only a real server showed:

**JSON reading and writing need different binders.** There is no "parse this text as JSON" cast to bind through - `JSON_QUERY` marks text as JSON but answers NULL for a scalar, where `CAST(? AS JSON)` and `json(?)` serve the other families in both directions. So a write binds the type the engine should store (a `BIT` becomes a JSON boolean, a number a JSON number) and a read binds the text `JSON_VALUE` yields (`'true'`, `'12'`). One binder served neither: booleans were stored as `1` and compared as `1` against text.

**`JSON_QUERY` cannot serve the JSON access mode at all**, for the same reason, so it falls back to the `OPENJSON` text read - which is what makes a boolean or number dot-path operand match. An array or object still comes back as its own JSON text, which is what `OPENJSON` takes next.

**`JSON_MODIFY` creates a path it does not find**, so a `$pull` against an absent key added an empty array where every other engine leaves the document alone. Guarded on `JSON_QUERY(col, path) IS NULL`.

**`tedious` types two columns the opposite way to `pg`.** `BIGINT` arrives as a string, which `decodeWireTypes` decodes - at the wire, for the reason [`pgNumericTypes`](../packages/uql-orm/src/postgres/pgNumericTypes.ts) gives: everything crosses it once, where hydration only sees entity reads. `DECIMAL` arrives as a JS number with the digits past 2^53 already gone, so a `String`-declared decimal is converted to text in the projection instead - the hook MariaDB uses to read a vector column.

`SET IDENTITY_INSERT` wraps an insert that states a key the engine would have generated, keyed off the same `isAutoIncrement` rule the schema generator asks.

**A column's own constraints pin it.** SQL Server keeps a `DEFAULT`, `CHECK` and `UNIQUE` as constraints under names it picks, and refuses to drop or retype the column past one. `MsSqlTableDdl` drops them first, looked up per column at run time - Knex and MikroORM do the same for the default, TypeORM drops all three by names it tracks - and adds the default back after a retype. An index or foreign key has a name the migration gave it, and stays the migration's to drop. Renames are `sp_rename`, as in every one of them.

### What 2025 adds, and what of it is worth taking

**`$regex` is emitted**, as `REGEXP_LIKE`. It needs 2025 at database compatibility level 170 and a server below that rejects it itself - the same terms `uuidv7()` is emitted on, where neither the version nor a database-scoped setting is knowable here. A first draft gated it behind a declared capability, which meant a new `EngineFeatures` field, a constant to spread, and `driverCapabilities` threaded through `ExtraOptions`: machinery for one operator, and machinery that contradicted the rule this repo already follows for version-gated SQL.

**Vector search is taken**, as exact search through `VECTOR_DISTANCE` - the shape sqlite-vec already has, every distance computed and no index read. 2025's DiskANN index is a preview feature that only `VECTOR_SEARCH` reads, never an `ORDER BY VECTOR_DISTANCE`, so an `@Index` on a vector column is left for the server to refuse. The query vector needs `CAST(... AS VECTOR(n))`; a write converts implicitly.

Two things were measured and declined, each for a reason rather than for later:

- **`JSON_ARRAYAGG`.** It would replace the `CASE [type]` re-encoding a `$pull` rebuilds its array with, but only above the floor, so both spellings would have to exist. More code, not less.
- **The native `json` column type.** `JSON_VALUE` stays capped at `nvarchar(4000)` on it and `JSON_QUERY` still answers NULL for a scalar, so every read would be spelled exactly as it already is. It buys validation on write and nothing else.

That last point settles something the design had assumed was a version gap: reading a scalar through `OPENJSON` is not a workaround for an old server, it is the permanent answer on every version including the newest.

### Still not started

- **The `OUTPUT`-into-`#out` fallback**, for a table carrying triggers. The plain form is emitted and the engine's own error is what a user sees.

## Out of scope

Stored procedures, materialized-view refresh, Oracle Text, SQL Server full-text, temporal tables, and `SET SESSION_CONTEXT` for RLS. One to remember rather than schedule: node-oracledb 7 added **pipelining** in thin mode, a genuine one-round-trip batch of the kind only D1, libSQL and Neon HTTP offer today - which is worth knowing when the roadmap's batching item comes up.
