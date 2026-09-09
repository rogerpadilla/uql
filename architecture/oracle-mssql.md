# Oracle and SQL Server

Design for two engines the [roadmap](roadmap.md) does not yet name. **SQL Server first, Oracle second**, behind one shared set of seams. R5 is _not_ a prerequisite for either - the first draft of this design assumed it was, and MikroORM's shipped Oracle driver proves otherwise.

## Why these two, and in that order

Market share answers the wrong question. What matters is whether a would-be adopter is _blocked_, and the two engines diverge sharply on that.

|                                                                   | SQL Server                                          | Oracle                             |
| :---------------------------------------------------------------- | :-------------------------------------------------- | :--------------------------------- |
| Developers using it ([SO 2025](https://survey.stackoverflow.co/)) | 25.3%                                               | 10.6%                              |
| Node driver downloads/month                                       | 17.4M (`tedious`)                                   | 3.5M (`oracledb`)                  |
| Shipped by                                                        | TypeORM, Sequelize, Knex, MikroORM, Prisma, Drizzle | TypeORM, Sequelize, Knex, MikroORM |
| UQL's position without it                                         | the only serious TS ORM missing it                  | in company with Prisma and Drizzle |

For reference, `pg` is 190M/month and `mariadb` - which UQL already supports - is 3.0M. MariaDB was nearly free because it is a MySQL fork sharing `MysqlLikeSqlDialect`; Oracle is a dialect from nothing. Same audience size, an order of magnitude apart in cost.

So: SQL Server is a gap that loses comparisons and blocks a real population (the .NET shop writing new Node services against an existing database). Oracle is a differentiator - Prisma has had [an open request since June 2020](https://github.com/prisma/prisma/issues/2853) - and worth building when someone asks, not before.

**Version floors, stated once.** SQL Server **2019+** (2016 works but is out of support), Oracle **23ai and up**, which Oracle [renamed AI Database 26ai](https://mikedietrichde.com/2025/10/14/oracle-ai-database-26ai-replaces-oracle-database-23ai/) in October 2025 while keeping the internal `23.x` version. The Oracle floor is what makes this design small: 23ai brought multi-row `VALUES`, native `BOOLEAN`, a native `JSON` type with `JSON_TRANSFORM`, and `VECTOR_DISTANCE`. Below it, every one of those needs a second code path - `INSERT ALL ... SELECT FROM dual`, `NUMBER(1)`, CLOB JSON - which is what TypeORM carries and why its Oracle driver is 4,700 lines.

## What this costs, measured against what shipped elsewhere

Lines of dialect/driver/introspection code in the sibling clones at `../`:

| ORM          | SQL Server |  Oracle |
| :----------- | ---------: | ------: |
| Kysely       |      1,324 |    none |
| Sequelize v7 |    1,520\* | 1,309\* |
| Knex         |      2,036 |   2,520 |
| MikroORM     |      2,498 |   3,577 |
| TypeORM      |     ~6,400 |  ~4,700 |

\* excludes the shared abstract query generator in core.

The shape is consistent: **introspection and DDL are the bulk, not the query builder.** MikroORM's `MsSqlSchemaHelper` is 1,164 lines against 269 for its query builder; `OracleSchemaHelper` is 1,031 against 309. Kysely gets away with 127 lines of query compiler because it never owns `$limit` - the user writes `.top()` or `.offset().fetch()` themselves. UQL does own it, so UQL pays where Kysely does not.

Budget: **~1,000 lines per engine**, split roughly 450 dialect / 350 introspector / 150 querier+pool / 60 index DDL. Less than everyone but Kysely, because `AbstractSqlDialect` already factors what those ORMs restate.

## The seams

Six places in the core assume MySQL- or Postgres-shaped SQL. Each is small; none can be worked around from a subclass.

### 1. The pager is a suffix

[`abstractSqlDialect.ts:1177`](../packages/uql-orm/src/dialect/abstractSqlDialect.ts#L1177) emits `LIMIT n OFFSET m`. Both engines want SQL:2008 `OFFSET m ROWS FETCH NEXT n ROWS ONLY`, and SQL Server rejects `OFFSET` without an `ORDER BY`.

Every other ORM solves this with **two** clauses - `TOP (n)` in the select list when there is a limit and no offset, `OFFSET/FETCH` otherwise. Knex, MikroORM and Kysely all do it that way, which means a select-list hook on top of the pager hook.

**UQL should not.** Emit `OFFSET 0 ROWS FETCH NEXT n ROWS ONLY` always, and synthesize `ORDER BY (SELECT NULL)` when the query carries no `$sort`. One hook instead of two, and it is the only way `$skip` without `$sort` keeps working - MikroORM throws `Order by clause is required for pagination` there, knex emits SQL the server rejects. A query that runs on four engines must not throw on the fifth.

> Verify on the container before committing: confirm SQL Server's optimizer introduces no sort operator for a constant `ORDER BY`. If it does, `TOP` comes back and so does the second hook.

The tax is in the specs, not the dialect: **46 hardcoded `LIMIT` assertions** in [`abstractSqlDialect-spec.ts`](../packages/uql-orm/src/dialect/abstractSqlDialect-spec.ts) plus 14 across the family and vector specs. `expected$skipClause()` is already the hook for one of them; generalize it to `expectedPager({ limit, skip })` and the change is mechanical.

```ts
readonly pagerSyntax: 'limit-offset' | 'offset-fetch' = 'limit-offset';
```

### 2. The returning clause is a suffix

[`abstractSqlDialect.ts:1414`](../packages/uql-orm/src/dialect/abstractSqlDialect.ts#L1414) appends `RETURNING` after the whole statement. SQL Server's `OUTPUT INSERTED."id"` sits between the column list and `VALUES` - TypeORM splices it at exactly that point, and so must this.

```ts
readonly returningPosition: 'suffix' | 'after-target' = 'suffix';
```

`appendInsertValues` takes an optional clause to splice after the column list; `insert` passes it when the position says so. Two lines in the base.

**Oracle keeps the suffix.** `RETURNING "id" INTO :out_id` _is_ trailing - what it needs is a bind descriptor, not a new position, and that does not belong in the dialect's SQL at all. Which brings us to:

### 3. Oracle's generated ids ride in the values array

`internalRun(sql, values)` ([`abstractSqlQuerier.ts:153`](../packages/uql-orm/src/querier/abstractSqlQuerier.ts#L153)) has nowhere to put an out-bind, and the querier never sees the entity. The first draft of this design concluded R5 (`compile()` returning a statement object) was the prerequisite.

It is not. **MikroORM's `OracleDriver` builds an `out_<column>` bind map, pushes it as the final entry of the params array marked `__outBindings`, and `OracleConnection` strips that entry and hands it to `oracledb` as bind options** - then reads `result.outBinds` back, dropping the prefix, into rows. node-oracledb [always returns DML-RETURNING binds as arrays](https://node-oracledb.readthedocs.io/en/latest/user_guide/bind.html), so one path covers single and multi-row inserts.

That is entirely containable in `OracleDialect` + `OracleQuerier`, needs no core contract change, and lets Oracle keep `insertIdSource: 'returning'` and the whole existing id-reporting path. R5 stays on the roadmap for batching, where it belongs.

Knex's Oracle does the older, worse thing - `RETURNING ROWID INTO :out` and a second query to resolve it. Do not copy that.

### 4. A regex predicate is an operator

[`abstractSqlDialect.ts:2228`](../packages/uql-orm/src/dialect/abstractSqlDialect.ts#L2228) is a `regexpOp` getter spliced as `col <op> ?`. Oracle spells it `REGEXP_LIKE(col, ?)` and SQL Server 2025 the same; a function, not an operator. Widen to a method:

```ts
protected regexCondition(operand: string, placeholder: string): string
```

SQL Server 2019/2022 have no regex at all and throw, the way `appendTextSearch` already does.

### 5. Case sensitivity is a collation, not an operator

**SQL Server's default collation is case-insensitive**, so `$eq` matches `'ABC'` against `'abc'` and `$ilike` is indistinguishable from `$like`. This is the opposite problem to the one `caseInsensitiveMatch` exists for, and it is silent. Knex handles it by appending `collate SQL_Latin1_General_CP1_CS_AS` to the case-_sensitive_ operators; do the same.

```ts
protected readonly caseSensitiveCollate: string | undefined = undefined;
```

### 6. `SQL_TO_CANONICAL` is one global name-to-type map

[`canonicalType.ts:26`](../packages/uql-orm/src/schema/canonicalType.ts#L26) parses a type name without knowing which engine printed it. That is already a latent conflation - `bit` maps to boolean, though it is a bit string on Postgres - and the new engines make it wrong rather than sloppy:

- SQL Server `float` is 8 bytes and `real` is 4; the table has the sizes the other way round.
- Oracle `NUMBER` is integer, decimal and float depending on its scale.
- `datetime2`, `datetimeoffset`, `uniqueidentifier`, `varchar2`, `clob`, `raw` are absent entirely.

A per-dialect override map layered over the shared one, consulted by `canonicalColumnType`. Without it, introspection silently mis-types columns and every diff churns.

### Also: the migrator's introspector switch

[`migrator.ts:116`](../packages/uql-orm/src/migrate/migrator.ts#L116) hard-codes a `switch` over every introspector, so `./migrate` - budget 50.4 KB gzipped - would carry two more engines for every user who never touches them. `createSchemaGeneratorAsync` already sets the dynamic-import precedent. Make it a registry keyed by `dialectName`.

## Knobs, per engine

Existing knobs get values; only the four above are new.

|                           | SQL Server                                                                     | Oracle                                         |
| :------------------------ | :----------------------------------------------------------------------------- | :--------------------------------------------- |
| `escapeIdChar`            | `"`                                                                            | `"`                                            |
| `pagerSyntax`             | `offset-fetch`                                                                 | `offset-fetch`                                 |
| `returningPosition`       | `after-target`                                                                 | `suffix`                                       |
| `insertIdSource`          | `returning`                                                                    | `returning` (via out-binds)                    |
| `autoIncrementSuffix`     | `IDENTITY(1,1)`                                                                | `GENERATED BY DEFAULT AS IDENTITY`             |
| `booleanLiteral`          | `integer` (`BIT`)                                                              | `native` (23ai)                                |
| `beginTransactionCommand` | `BEGIN TRANSACTION`                                                            | none - `[]`, with `autoCommit: !inTransaction` |
| `isolationLevelStrategy`  | `set-before`                                                                   | `set-before`                                   |
| `alterColumnSyntax`       | `ALTER COLUMN`                                                                 | `MODIFY`                                       |
| `commentSyntax`           | `none` (extended properties are not comments)                                  | `statement`                                    |
| `renameColumn`            | false (`sp_rename` is a proc, not DDL)                                         | true                                           |
| `dropTableCascade`        | false                                                                          | true (`CASCADE CONSTRAINTS`)                   |
| `supportsRowLocks`        | true, as table hints                                                           | true, `FOR UPDATE` verbatim                    |
| `maxBindValues`           | **2100** - [a hard server limit](https://github.com/yiisoft/yii2/issues/10371) | 65535                                          |
| `schemas`                 | true, default `dbo`                                                            | true                                           |
| `caseSensitiveCollate`    | `SQL_Latin1_General_CP1_CS_AS`                                                 | undefined                                      |
| `regexCondition`          | throws below 2025                                                              | `REGEXP_LIKE`                                  |
| `$text`                   | throws (needs a full-text catalogue)                                           | throws (needs a CONTEXT index)                 |

**Identifiers stay `"`-quoted on both.** MikroORM and knex both chose `[...]` for SQL Server, which would make `escapeIdChar` a pair rather than a char and break the ~50 spec assertions that read `dialect.escapeIdChar`. `"` is ANSI, Kysely uses it, and [tedious sets `enableQuotedIdentifier: true` by default](https://www.jsdocs.io/package/tedious). On Oracle, quoting is what preserves `createdAt` from being folded to `CREATEDAT` - the inlined Kysely compiler in MikroORM's Oracle package drops quoting entirely and pays for it with uppercase column keys. UQL already asks Postgres users to live with quoted camelCase; this is the same trade.

## The seven things that will silently break

Ordered by how quietly they fail. Each needs a test before the feature it belongs to.

1. **Unicode on SQL Server.** `VARCHAR` is a codepage type; only `NVARCHAR` holds Unicode, and an inlined literal needs an `N` prefix to survive. MikroORM carries a whole `UnicodeStringType` for this because it exposes the choice to users. UQL does not, so it is two lines: map `string` to `NVARCHAR` in the type map, and prefix in `escape()`. Bound parameters are fine - tedious binds JS strings as `NVarChar`. Get this wrong and non-ASCII data is destroyed on write with no error.
2. **`''` is `NULL` on Oracle.** Nothing can fix it. It needs an overridable expectation in the shared suites, the `expectedMixedBatchIds` pattern, and a line in the docs.
3. **`OUTPUT` is rejected on a table with triggers** ("cannot have any enabled triggers if the statement contains an OUTPUT clause without INTO"), and on some cascade-FK shapes. Knex and MikroORM _independently_ arrived at the same workaround: `SELECT TOP(0) ... INTO #out ...; INSERT ... OUTPUT ... INTO #out ...; SELECT ... FROM #out; DROP TABLE #out`. Four statements. Ship without it, detect the error, and add it behind a flag - do not pretend the plain form always works.
4. **`SET IDENTITY_INSERT ON/OFF`** must wrap any insert that writes an explicit key. UQL's own fixtures do this constantly, so this surfaces on the first integration run rather than in production. Both MikroORM and knex gate it behind a flag.
5. **Multiple cascade paths.** Both engines refuse an FK graph with two cascade routes to one table (SQL Server error 1785). `MsSqlPlatform` and `OraclePlatform` both answer `supportsMultipleCascadePaths(): false`. `defaultForeignKeyAction` must fall back to `NO ACTION` on both, or a diamond-shaped schema fails to create at all.
6. **Row-value comparison is unsupported on SQL Server.** Only matters for the roadmap's cursor pagination, which already plans an OR-chain fallback. Note it there now so it is not discovered later.
7. **Default NULL sort position.** Oracle sorts NULLs last ascending (with Postgres); SQL Server sorts them first (with MySQL and SQLite). Neither engine has `NULLS FIRST/LAST` at query level on SQL Server - MikroORM synthesizes `CASE WHEN col IS NULL`. UQL exposes no query-level nulls ordering, so this is documentation, not code. It is also an inconsistency UQL already has between Postgres and MySQL.

Two more that cost nothing but should be written down: Oracle cannot run multiple statements in one `execute` (`splitSqlStatements` already handles it), and SQL Server's `TRUNCATE` needs elevated rights and fails against FKs, so it is `DELETE` + `DBCC CHECKIDENT` reseed - which is what MikroORM emits.

## Upsert: one `MERGE`, shared

The one genuine piece of reuse between the two engines. Both spell it the same way, and both need the trailing semicolon SQL Server requires:

```sql
MERGE INTO "Item" USING (VALUES (?, ?)) AS s ("id", "name") ON "Item"."id" = s."id"
WHEN NOT MATCHED THEN INSERT ("id", "name") VALUES (s."id", s."name")
WHEN MATCHED THEN UPDATE SET "name" = s."name";
```

Oracle differs only in the source: `USING (SELECT ? "id", ? "name" FROM dual) s`, and 23ai [dropped the need for `dual`](https://oracle-base.com/articles/23/table-values-constructor-23) so a values constructor works there too. A `MergeUpsertDialect` between `AbstractSqlDialect` and the two concrete dialects carries it once, the way `MysqlLikeSqlDialect` carries `ON DUPLICATE KEY UPDATE`.

## Locking

Oracle inherits `appendLock` unchanged - `FOR UPDATE OF ... SKIP LOCKED / NOWAIT` is verbatim what the base emits.

SQL Server has no `FOR UPDATE`. It is a table hint placed immediately after the table reference: `WITH (UPDLOCK, ROWLOCK)`, plus `READPAST` for `$lock: 'skip'` and `NOWAIT` for `'nowait'`. `tableRef()` is already the hook, but it does not see the query - threading `q` into it is a three-call-site change. Worth doing: `$lock` is a headline feature and shipping SQL Server with `supportsRowLocks: false` would be a visible hole.

## Vectors, declined for now

Both engines have native vector search - [Oracle 23ai](https://www.oracle.com/database/ai-native-database-26ai/) and [SQL Server 2025 RTM](https://learn.microsoft.com/en-us/sql/t-sql/data-types/vector-data-type?view=sql-server-ver17), both with a `VECTOR_DISTANCE` function taking a metric name. That is exactly the shape `vectorMetrics` already models, so it is a ~30-line addition per engine whenever it is wanted. Declining it in v1 halves the integration matrix for a capability nobody has asked these engines for.

`estimatedCount` ships on SQL Server (`sys.dm_db_partition_stats`, live) and not on Oracle (`USER_TABLES.NUM_ROWS` is stale until stats are gathered, and a confidently wrong number is worse than the refusal the base already throws).

## Testing

Both engines are heavy, and one of them cannot run natively on the machine this repo is developed on.

- **Oracle**: `gvenzl/oracle-free`, [natively multi-arch since 23.5](https://www.geraldonit.com/oracle-database-free-for-arm-and-multi-platform-images-now-available/), boots in ~45s.
- **SQL Server**: `mcr.microsoft.com/mssql/server` is **amd64 only**, and [2025 RTM additionally requires AVX](https://www.nocentino.com/posts/2025-11-26-sql-server-2025-docker-desktop-avx-issue/), which Docker Desktop's Rosetta layer does not provide. **Pin 2022** for local and CI unless the 2025 vector or JSON types are being worked on.

`bun run test` already runs the vitest and Bun suites sequentially because they share the containers. Adding two engines that take a minute to become healthy would push the everyday gate past the point where it gets run. **Both go behind a separate `test:enterprise` script from the first commit**, run in CI and on demand, not in `bun run check`. That is a decision to make now, not after the first engine lands.

## Build order

| Phase | Work                                                                                 | Size     |
| :---- | :----------------------------------------------------------------------------------- | :------- |
| **0** | Seams 1-6 and the introspector registry. No engine.                                  | ~1 week  |
| **1** | SQL Server: dialect, introspector, querier+pool, index DDL, specs, `test:enterprise` | ~2 weeks |
| **2** | Oracle: the same, plus the out-bind path and the `''`-is-`NULL` expectations         | ~2 weeks |

Phase 0 is worth doing for SQL Server alone. Two of its six items - the type-map split and the introspector registry - are cleanups the codebase wants regardless of whether either engine is ever built.

## What is not in scope

Stored procedures, `REFRESH MATERIALIZED VIEW` equivalents, Oracle Text, SQL Server full-text, temporal tables, `SET SESSION_CONTEXT` for RLS, and Oracle's node-oracledb 7 pipelining - though that last one is worth remembering when batching lands, since it is a genuine one-round-trip batch of the kind only D1, libSQL and Neon HTTP offer today.
