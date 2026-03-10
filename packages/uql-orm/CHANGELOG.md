# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.2.4](https://github.com/rogerpadilla/uql/compare/uql-orm@0.2.3...uql-orm@0.2.4) (2026-03-10)


### Bug Fixes

* Correctly generate `EXISTS` subqueries for ManyToOne and OneToOne relation filtering in `$where` clauses and add querier listener tests. ([4c7e97a](https://github.com/rogerpadilla/uql/commit/4c7e97a08efe62a61735f7e9f61478b43511e2ae))





# Changelog

All notable changes to this project will be documented in this file. Please add new changes to the top.

date format is [yyyy-mm-dd]

## [0.2.4] - 2026-03-10
### Bug Fixes
- **ManyToOne / OneToOne relation filtering**: `$where` clauses referencing `m1` or `11` relations (e.g., `{ item: { name: 'Widget' } }`) now correctly generate `EXISTS` subqueries. Previously, these cardinalities were unhandled and fell through to `compareFieldOperator`, throwing an "unknown operator" error. The `compareRelation` method now supports all four cardinalities (`mm`, `1m`, `m1`, `11`) with direction-aware join resolution.

### Test Coverage
- Added tests for ManyToOne relation filtering: simple equality, operator filter (`$like`), and combined with regular fields.

## [0.2.3] - 2026-03-09
### Documentation
- **Aggregate Queries guide**: Added dedicated [aggregate documentation page](https://uql-orm.dev/querying/aggregate) covering `$group`, `$having`, `$where` vs `$having`, sorting/pagination, and `$distinct`.
- **README**: Added Aggregate Queries to features table, new §4 subsection with code examples and generated SQL, and "Learn more" link.
- **Querier methods table**: Added `aggregate()` to the website's querier reference.
- **Simplified tsconfig**: Removed `module`/`target` from recommended config — only decorator flags are UQL-specific. Added Pure ESM note.

## [0.2.2] - 2026-03-09
### New Features
- **Aggregate Query API**: Added `querier.aggregate()` with full support across all SQL dialects and MongoDB. Includes typed `QueryAggregate<E>`, `QueryGroupMap`, `QueryHavingMap`, and `QueryAggregateOp` types. Supports `$group` (with `$count`, `$sum`, `$avg`, `$min`, `$max`), `$having` (post-aggregation filtering with operator support), `$where` (pre-aggregation filtering), `$sort`, `$skip`, and `$limit`.
  ```ts
  const results = await querier.aggregate(Order, {
    $group: { status: true, total: { $sum: 'amount' }, count: { $count: '*' } },
    $having: { count: { $gt: 5 } },
    $sort: { total: -1 },
  });
  ```
  - **SQL**: Generates `SELECT … GROUP BY … HAVING … ORDER BY` with proper escaping and parameterization.
  - **MongoDB**: Generates a full aggregation pipeline (`$match → $group → $project → $match → $sort → $skip → $limit`).
- **`$distinct` support**: Added `$distinct` option to `Query<E>` for `SELECT DISTINCT` queries.

### Bug Fixes
- **Sort direction with numeric `-1`**: `SORT_DIRECTION_MAP` only had the string key `'-1'`, not the numeric `-1` from `QuerySortDirection`. Queries using `$sort: { field: -1 }` silently produced ascending order. Now both numeric and string forms work correctly.
- **MongoDB sort normalization**: Unified sort direction normalization into `sort()` method, ensuring all callers (find queries and aggregate pipelines) normalize string directions (`'asc'`/`'desc'`) to numeric `1`/`-1` for the MongoDB server.

### Type Safety
- **`QueryAggregateFn` enforces single operation**: Changed from a mapped type (which allowed invalid `{ $count: '*', $sum: 'amount' }`) to a discriminated union that enforces exactly one aggregate op per entry.
- **HAVING `$in`/`$nin` support**: `havingCondition` now supports `$in` and `$nin` operators (e.g., `HAVING COUNT(*) IN (5, 10)`).
- **HAVING `$isNull`/`$isNotNull` support**: `havingCondition` now supports null-checking operators (e.g., `HAVING MAX(score) IS NULL`).

### Code Quality
- **`compareFieldOperator` compaction**: Reduced from 142 to 85 lines (−40%) by extracting `COMPARE_OP_MAP` (simple comparison operators), `LIKE_OP_MAP` (8 string/LIKE operators), and unifying `$in`/`$nin` into a single code path.
- **`saveRelation` split**: Decomposed the 61-line monolith into a dispatcher + 3 focused helpers by cardinality: `saveToMany` (1:M + M:M), `saveOneToOne` (1:1), `saveManyToOne` (M:1).
- **`buildAggregateStages` complexity reduction**: Extracted `buildHavingFilter()` helper from the MongoDB aggregation pipeline builder, bringing cognitive complexity under the linter threshold.
- **`deleteMany` DRY**: Eliminated duplicated `emitHook → internalDeleteMany → deleteRelations` logic by reusing the `resolveEntityAndQuery()` pattern.
- **`directionMap` deduplication**: Extracted the `asc/desc → 1/-1` mapping into a static `SORT_DIRECTION_MAP` constant shared by `sort()` and `aggregateSort()`.
- **`parseGroupMap` shared utility**: Eliminated `$group` parsing duplication between SQL and MongoDB dialects with a single generator function in `dialect.util.ts`.
- **`transformOperators` compaction**: Replaced verbose `if/else if` chains with a static `MONGO_COMPARISON_OP_MAP` lookup, and absorbed `$like`/`$ilike` into `REGEX_OP_MAP`.
- **`putChildrenInParents` simplification**: Simplified child-grouping loop using explicit initialization pattern.
- **`findManyAndCount` cleanup**: Replaced spread + triple-delete mutation with clean destructuring.
- **`insertRelations` cleanup**: Replaced `.map()` with implicit undefined return with `.filter().map()` pattern.
- **Dead code removal**: Removed dead `Array.isArray` branch in `fillToManyRelations` (array-based `$select` was removed in 3.14.0), dead `Promise.resolve()` in async context, unused generic type parameter.
- **`havingCondition` visibility**: Changed from `private` to `protected` to allow dialect subclass overrides.
- **`insertRelations` DRY**: Eliminated double `filterPersistableRelationKeys` call per item using a single `.reduce()` pass.
- **`where()` loop**: Replaced `.reduce()` accumulator in MongoDB `where()` with a cleaner `for...of` loop.
- **`_id` constant**: Extracted repeated `'_id'` string literal to `MongoDialect.ID_KEY` class constant.
- **`negateOperatorMap` static**: Promoted per-call `negateOperatorMap` allocation in `compareLogicalOperator` to `static readonly NEGATE_OP_MAP`.
- **`AGGREGATE_OP_MAP` class-level**: Moved module-level `MONGO_AGGREGATE_OP_MAP` to `MongoDialect.AGGREGATE_OP_MAP` static, consistent with `REGEX_OP_MAP` and `NATIVE_OPS`.

### Test Coverage
- Added comprehensive tests for `aggregate()` (all SQL dialects + MongoDB pipeline stages), HAVING `$in`/`$nin`/`$isNull`/`$isNotNull`, sort with numeric `-1`, mixed sort directions, MongoDB string-to-numeric sort normalization, aggregate pagination, `parseGroupMap` (edge cases), and `deleteMany` dual-API pattern. All coverage thresholds met.

## [0.2.1] - 2026-03-08
### New Features
- **`@Transactional({ isolationLevel })` support**: The decorator now accepts an `isolationLevel` option, forwarded to `beginTransaction()`.
- **`pool.transaction(callback, opts?)` support**: `TransactionOptions` (including `isolationLevel`) are now forwarded through the pool to `querier.transaction()`.
- **Transaction reuse (nesting)**: `querier.transaction()` and `@Transactional()` now reuse the active transaction when called inside an existing one, enabling composable service methods. `beginTransaction()` remains strict (throws if already in a transaction).

## [0.2.0] - 2026-03-08
### New Features
- **Transaction Isolation Levels**: `beginTransaction()` and `transaction()` now accept an optional `TransactionOptions` object with an `isolationLevel` property. Supports all standard SQL isolation levels: `read uncommitted`, `read committed`, `repeatable read`, and `serializable`.
  - **PostgreSQL**: Uses inline syntax (`BEGIN TRANSACTION ISOLATION LEVEL ...`).
  - **MySQL / MariaDB**: Uses the `SET TRANSACTION ISOLATION LEVEL` + `START TRANSACTION` two-statement pattern.
  - **SQLite / LibSQL / MongoDB**: Isolation level is silently ignored (these databases do not support configurable isolation levels).
  ```ts
  await querier.beginTransaction({ isolationLevel: 'serializable' });
  // or with the callback API
  const result = await querier.transaction(async () => {
    return querier.findMany(User, {});
  }, { isolationLevel: 'read committed' });
  ```
- **Config-Driven Dialect Strategy**: Added `isolationLevelStrategy` to `DialectConfig` (`'inline'` | `'set-before'` | `'none'`), enabling declarative per-dialect SQL generation without dialect-name branching.

## [0.1.5] - 2026-03-08
### Type Safety
- **Eliminated `any` Types**: Replaced `any` with proper types across decorators (`serialized.ts`, `log.ts`, `transactional.ts`), Express middleware (`querierMiddleware.ts`), MongoDB dialect pipeline types, SQLite querier pool, and migrator. Remaining `any` usages are documented and justified (generic variance, `Reflect.getMetadata`).
- **Typed `raw()` Return**: `raw()` now returns `QueryRaw` instead of `any`, enabling IDE autocompletion and compile-time validation.

### Bug Fixes
- **Fixed `IsolationLevel` Typo**: Corrected `'repeteable read'` → `'repeatable read'` in the `IsolationLevel` type.

### Security
- **`raw()` Safety Documentation**: Added JSDoc warning that `raw()` bypasses SQL parameterization, with guidance to use `$where` operators for user-supplied data.

## [0.1.4] - 2026-03-08
### Bug Fixes
- **Fixed Virtual Field Alias in Relations**: `getRawValue` was missing a dot separator in prefixed aliases and had a stale dot→underscore replacement from the old convention. Added tests to prevent regressions.

## [0.1.3] - 2026-03-08
### Code Quality
- **Internal Code Cleanup**: Eliminated unnecessary allocations and simplified utility functions across the codebase. Removed dead code and redundant variables.

## [0.1.1] - 2026-03-08
### Bug Fixes
- **Fixed Row Parsing for Underscore Columns**: Columns containing underscores (e.g., `user_id`) were incorrectly unflattened into nested objects (`{ user: { id: value } }`). SQL JOIN aliases now use quoted dot-notation (e.g., `` `profile.pk` `` instead of `` `profile_pk` ``), eliminating the ambiguity. Dot-delimited aliases are safe because they are always quoted identifiers. Updated tests to prevent regressions.

### Performance
- **Faster SQL Query Generation**: Optimized the internal SQL generation pipeline to reduce overhead on every query. Identifier escaping now reuses pre-compiled regex patterns instead of creating new ones per call. Relation detection short-circuits without intermediate array allocations. The query context tracks SQL length incrementally, avoiding repeated string joins. These changes reduce per-query CPU and memory cost, improving throughput for high-volume workloads.
- **Zero-Allocation Row Parsing**: `unflatObjects` now uses index-based path traversal instead of `slice().reduce()`, eliminating an array allocation per nested column per row.

## [0.1.0] - 2026-03-08
### Package Rename
- **Renamed `@uql/core` → `uql-orm`**: The package is now published as an unscoped name for better SEO, discoverability, and simpler install commands (`npm install uql-orm`).
- **Version Reset to `0.1.0`**: Fresh start to reflect UQL's modern, fast-moving nature. All functionality from `@uql/core@3.15.0` is preserved — this is a rename, not a rewrite.
- **New Homepage**: [uql-orm.dev](https://uql-orm.dev)
- **Migration**: Update your imports from `@uql/core` → `uql-orm` (e.g., `import { Entity } from 'uql-orm'`). Sub-path imports follow the same pattern (e.g., `uql-orm/postgres`, `uql-orm/migrate`).

## [3.15.0] - 2026-03-07
### New Features
- **Lifecycle Hooks**: Added entity-level lifecycle hook decorators for domain-specific logic. Seven decorators are available: `@BeforeInsert()`, `@AfterInsert()`, `@BeforeUpdate()`, `@AfterUpdate()`, `@BeforeDelete()`, `@AfterDelete()`, and `@AfterLoad()`. Hooks receive a `HookContext` with access to the active `querier` for transactional DB operations.
  ```ts
  @Entity()
  class Article {
    @BeforeInsert()
    generateSlug() {
      this.slug = this.title.toLowerCase().replace(/\s+/g, '-');
    }

    @AfterLoad()
    maskSensitiveData() {
      this.internalCode = '***';
    }
  }
  ```
- **Global Querier Listeners**: Added `QuerierListener` interface and `listeners` option on `ExtraOptions` for cross-cutting concerns (audit logging, automatic timestamps, cache invalidation). Listeners fire before entity-level hooks.
  ```ts
  const pool = new PgQuerierPool(connectionConfig, {
    listeners: [{
      beforeInsert: ({ entity, payloads }) => { /* audit log */ },
      afterUpdate: ({ entity, querier }) => { /* invalidate cache */ },
    }],
  });
  ```

### Architecture
- **Renamed Internal Methods**: `insertMany`/`updateMany` in `AbstractSqlQuerier` and `MongodbQuerier` are now `internalInsertMany`/`internalUpdateMany` (protected). Public `insertMany`/`updateMany` in `AbstractQuerier` wrap them with hook emission.
- **New Utility**: `runHooks()` in `util/hook.util.ts` — lightweight hook invocation engine using `entity.prototype[method].call(payload, ctx)`.
- **Hook Inheritance**: Entity hooks are inherited from parent classes (parent hooks execute first).

### Test Coverage
- **22 new tests** (11 for decorators, 11 for `runHooks`). Total: **1602 tests passing**. Coverage: Statements 97.2%, Branches 90.1%, Functions 98.4%, Lines 98.0%.

## [3.14.0] - 2026-03-07
### Type Safety
- **Map-Only `$select`**: `$select` now only accepts the map form (e.g., `{ id: true, name: true }`), removing the less type-safe array form. Relation selections are now additive in map form.
- **Stricter `$and`/`$or`/`$not`/`$nor`**: Logical operators now only accept `QueryWhereMap | QueryRaw` elements — bare ID values (e.g., `$or: [5]`) must use the explicit form `$or: [{ id: 5 }]`. This restores TypeScript's excess property checking inside logical clauses.
- **Wider JSON Array Operators**: `$elemMatch` and `$all` now accept JSON fields without requiring `as any` casts, thanks to widened fallback types for non-array field types. Removed 6 unnecessary `as any` casts from tests.

### Refactoring
- **Simplified Express Middleware**: `$where` ID injection in `querierMiddleware` now always uses map form, properly converting array `$where` from query strings to `{ id: { $in: [...] } }`.
- **Removed `QueryWhereSingle`**: Consolidated into a flattened `QueryWhere<E>` union. Introduced reusable `QueryWhereArray<E>` type alias.

## [3.13.1] - 2026-03-07
### Type Safety
- **Fully Typed Querier Returns**: Remaining querier methods now return proper types instead of `unknown`, enabling IDE autocompletion and compile-time validation on query results for all methods.
- **Semantic `RawRow` Type**: Introduced `RawRow` as a reusable semantic alias for raw database result rows, replacing scattered `Record<string, unknown>` and `any` across queriers, introspection, and SQL utilities.
- **Typed MySQL Driver**: Replaced `any` in MySQL2 querier with proper `ResultSetHeader` type from the driver.
- **Smarter `$select` Validation**: Field and relation selections are now validated simultaneously, catching invalid property names at compile time.
- **Stricter Null Comparisons**: `null` is now only accepted in `$eq` and `$ne` operators — invalid comparisons like `$gt: null` are caught at compile time.
- **Typed `defaultValue`**: Entity field defaults are now type-checked instead of accepting `any`.

### API Surface & DX
- **Cleaner Querier Interfaces**: `ClientQuerier` and `UniversalQuerier` are now properly separated with documented contracts, preventing confusing type mismatches.
- **Reduced Public API**: Removed unused/redundant type exports (`QuerySearchOne`, `QueryConflictPathsMap`), making the API surface smaller and easier to navigate.
- **Improved JSDoc**: Added cross-references between related operators (`$not` root vs field) for better discoverability.

### Refactoring
- **DRY Relation Iteration**: Consolidated duplicated relation iteration logic into `forEachJoinableRelation`, eliminating ~35 duplicated lines.
- **DRY `compareJsonPath`**: Simplified from 6 parameters to 3, removing redundant internal calls.
- **DRY `extractInsertResult`**: Shared utility for INSERT result ID extraction across all RETURNING-based drivers (pg, neon, maria), eliminating duplicated logic.
- **Eliminated Type Casts**: Replaced `Record<string, unknown>` casts with proper type guards across the dialect layer.
- **Typo Fix**: Renamed `buldQueryWhereAsMap` → `buildQueryWhereAsMap`.

## [3.13.0] - 2026-03-07
### New Features
- **`QueryRaw` Class Refactoring**: Replaced the opaque type + type-guard pattern with a proper `class` using `Symbol`-keyed properties (`RAW_VALUE`, `RAW_ALIAS`). Enables `instanceof QueryRaw` checks, eliminates autocomplete pollution, and prevents accidental structural matches.
- **JSON `$merge`/`$unset` Operators**: Restored type-safe partial update of JSONB fields via `$merge` (shallow merge) and `$unset` (key removal) in `update()` payloads. Works across PostgreSQL (`||`/`-`), MySQL (`JSON_MERGE_PATCH`/`JSON_REMOVE`), and SQLite (`json_patch`/`json_remove`).
  ```ts
  await querier.updateMany(Company, { $where: { id: 1 } }, {
    kind: { $merge: { theme: 'dark' }, $unset: ['deprecated'] },
  });
  ```
- **JSON Dot-Notation Sorting**: `$sort` now supports JSONB dot-notation paths (e.g. `{ 'kind.priority': 'desc' }`), sharing the `resolveJsonDotPath` helper with `$where` for DRY consistency.


## [3.12.1] - 2026-03-05
### Bug Fixes
- **Null-Safe JSONB `$ne`**: JSONB dot-notation `$ne` now uses null-safe operators (`IS DISTINCT FROM` on PostgreSQL, `IS NOT` on SQLite) so that absent keys (which return SQL `NULL`) are correctly included in results. Previously, `{ 'settings.isArchived': { $ne: true } }` would silently exclude rows where the key didn't exist.
- **JSONB `$eq`/`$ne` with `null`**: `$eq: null` and `$ne: null` on JSONB paths now correctly generate `IS NULL` / `IS NOT NULL` instead of `= NULL` / `<> NULL`.

### Improvements & Refactoring
- **`QueryWhereMap` Type Safety**: Replaced the overly permissive `Record<string, ...>` catch-all with explicit typed unions: template literal `` `${string}.${string}` `` for dot-paths, `RelationKey<E>` for relation filtering, and `JsonFieldPaths<E>` for IDE autocompletion.
- **`DeepJsonKeys` Recursive Type**: `JsonFieldPaths<E>` now derives dot-notation paths up to 5 levels deep (previously only 1 level), enabling autocompletion for nested JSONB structures like `'kind.theme.color'`.
- **DRY `compare()` Signature**: Simplified `compare()` from `<E, K extends keyof QueryWhereMap<E>>(key: K, val: QueryWhereMap<E>[K])` to `<E>(key: string, val: unknown)` across all dialect overrides, removing redundant generic constraints.
- **DRY SQLite Config**: SQLite's `getBaseJsonConfig()` now spreads from `super` instead of duplicating 4 identical fields.

### Test Coverage
- Removed ~20 `as any` casts from tests (now unnecessary with improved types). Added null-safe `$ne` tests across all dialects. Total: **1,563 tests passing**.

## [3.12.0] - 2026-03-05
### New Features
- **JSONB Dot-Notation Operators**: Filter by nested JSON field paths directly in `$where` with full operator support (`$eq`, `$ne`, `$gt`, `$lt`, `$like`, `$ilike`, `$in`, `$nin`, `$regex`, etc.). Works across PostgreSQL, MySQL, and SQLite.
  ```ts
  await querier.findMany(User, {
    $where: { 'settings.isArchived': { $ne: true } },
  });
  ```
- **Relation Filtering**: Filter by ManyToMany and OneToMany relations using automatic EXISTS subqueries. No more manual `raw()` joins.
  ```ts
  await querier.findMany(Item, {
    $where: { tags: { name: 'important' } },
  });
  ```
- **`Json<T>` Marker Type**: Wrap JSONB field types with `Json<T>` to ensure they are classified as `FieldKey` (not `RelationKey`), enabling type-safe usage in `$where`, `$select`, and `$sort`.
  ```ts
  @Field({ type: 'jsonb' })
  settings?: Json<{ isArchived?: boolean }>;
  ```
- **`JsonFieldPaths<E>` Autocompletion**: Template literal type that derives valid dot-notation paths from `Json<T>` fields (e.g., `'kind.public' | 'kind.private'`). Provides IDE autocompletion for JSONB `$where` queries without restricting arbitrary string paths.

### Bug Fixes
- **raw() String Prefix Fix**: String-based `raw()` values in `$and`/`$or` are no longer incorrectly table-prefixed (e.g., `raw("kind IS NOT NULL")` previously produced `resource.kind IS NOT NULL` instead of `kind IS NOT NULL`).

### Improvements & Refactoring
- **DRY JSON Config**: Extracted `getBaseJsonConfig()` in each dialect — `$elemMatch` and dot-notation now compose from a single config source, eliminating ~20 lines of duplication.
- **Extracted `normalizeWhereValue()`**: Deduplicated the `Array→$in / object→passthrough / scalar→$eq` normalization used by both regular field and JSON path comparisons.
- **Cleaner Dot-Notation Detection**: Uses `indexOf`+`slice` instead of two `split('.')` calls for efficient dot-path parsing.
- **Relation Safety Guard**: `compareRelation()` now throws a descriptive `TypeError` if `rel.references` is missing, instead of a cryptic undefined crash.
- **TypeScript 6 Compatibility**: Fixed `QueryWhereMap` circular type reference and expanded `QueryWhereOptions.clause` union.

### Test Coverage
- **46 new tests** across 3 dialects (base, PostgreSQL, SQLite) covering all new features and edge cases. Total: **1561 tests passing**.

## [3.11.1] - 2026-02-26
### Improvements
- **Expanded ColumnType Aliases**: Added `integer`, `tinyint`, `bool`, `datetime`, and `smallserial` as first-class `ColumnType` values (aliases for `int`, `boolean`, `timestamp`, `smallserial`, and `serial` respectively). Users can now use standard SQL keywords interchangeably (e.g., `integer` or `int`, `bool` or `boolean`, `datetime` or `timestamp`).
- **Auto-Increment Fix**: `smallserial` columns are now correctly detected as auto-incrementing, consistent with `serial` and `bigserial`.

## [3.11.0] - 2026-02-21
### New Features
- **Scoped Querier**: Added `pool.withQuerier(callback)` — the non-transactional counterpart to `pool.transaction()`. Acquires a querier, runs the callback, and guarantees release via `try/finally`. Useful for scoping connection lifetime without transaction overhead.

  ```ts
  const users = await pool.withQuerier(async (querier) => {
    return querier.findMany(User, { $limit: 10 });
  });
  // querier is automatically released here
  ```

## [3.10.0] - 2026-02-18
### New Features
- **Bulk Upsert**: Added `upsertMany` operation to the `Querier` and `UniversalQuerier` interfaces, enabling efficient bulk insert-or-update across all supported databases.
  - **SQL** (PostgreSQL, MySQL, MariaDB, SQLite): Uses a single `INSERT ... ON CONFLICT/ON DUPLICATE KEY UPDATE` statement with array payloads.
  - **MongoDB**: Uses `bulkWrite` with `updateOne` + `upsert: true` operations.
  - `upsertOne` now delegates to `upsertMany` in SQL dialects for DRY internals; MongoDB retains independent `findOneAndUpdate` for optimal single-document behavior.

### Test Coverage
- **Branch coverage improved from ~88% to 90%** with targeted tests across `schemaAST`, `entityMerger`, `driftDetector`, `canonicalType`, and `tableBuilder`.

### Dependencies
- `@biomejs/biome` 2.3.15 → 2.4.2
- `rimraf` 6.1.2 → 6.1.3
- `mariadb` 3.4.5 → 3.5.1
- `mysql2` 3.17.1 → 3.17.2

## [3.9.2] - 2026-02-13
### Improvements & Refactoring
- **Reduced Cognitive Complexity**: Extracted `compareLogicalOperator` from `AbstractSqlDialect.compare` and `countBraces` helper from `EntityMerger.findInsertPosition`, bringing both functions under the biome complexity threshold.
- **Tighter Type Safety**: Replaced `any` with `unknown` across the logger interface, field utilities, and D1 bindings. Typed all DB querier constructors with `ExtraOptions` instead of `any`.

## [3.9.1] - 2026-02-13
### Improvements & Refactoring
- **TypeScript Upgrade**: Upgraded to TypeScript ^5.9.3 and hardened `tsconfig.json` with strict flags (`noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`, etc.).
- **Type Safety Polish**: Propagated `E extends object` constraint across the `Querier` hierarchy and refined driver signatures to eliminate type casts (`as any`).

### Bug Fixes
- **MySQL Introspection Fix**: Fixed a bug where string default values were returned with surrounding quotes (e.g., `'active'`) during schema discovery in MySQL and MariaDB.

## [3.9.0] - 2026-02-13
### New Features
- **New Query Operators**: Added `$between`, `$isNull`, `$isNotNull`, `$all`, `$size`, and `$elemMatch` operators with full support across PostgreSQL, MySQL, SQLite, and MongoDB.
- **Dual-API Pattern**: Querier read and delete methods (`findOne`, `findMany`, `findManyAndCount`, `count`, `deleteMany`) now accept either the classic `(Entity, query)` call or an RPC-friendly `({ $entity: Entity, ...query })` call. This enables cleaner serialization for RPC/REST endpoints.

### Improvements & Refactoring
- **Structured Slow-Query Config**: Replaced flat `slowQueryThreshold: number` with a `slowQuery: { threshold, logParams? }` object. Use `logParams: false` to suppress sensitive query parameters from slow-query logs.
- **DRY Dialect Refactor**: Extracted shared `$elemMatch` field-condition logic into `buildJsonFieldCondition` in `AbstractSqlDialect` with a `JsonFieldConfig` type. Each SQL dialect now passes a small config object (~10 lines) instead of duplicating a ~60-line switch across MySQL, PostgreSQL, and SQLite.
- **Safer Abstract Base**: `$all`, `$size`, and `$elemMatch` now throw in the abstract SQL dialect base class, forcing each dialect subclass to provide its own implementation. This prevents silent inheritance of dialect-specific syntax.

### Bug Fixes
- **SQLite `$in`/`$nin` Fix**: Fixed a critical bug where `buildJsonFieldOperator` used `vals.shift()` inside `.map()`, mutating the input array and only processing half the values.
- **Accurate Slow-Query Logging**: The `@Log()` timer now excludes connection establishment (TCP/SSL handshake) time. Previously, the first query on a new connection could trigger false slow-query alerts. Connection setup (`lazyConnect()`) is now centralized in `all()`/`run()` outside the `@Log()` scope.

## [3.8.4] - 2026-01-09
### Improvements
- **Strict Type Polish**: Replaced remaining `any` type usage with `unknown` in the SQL introspection layer for improved safety. Refactored `toNumber` to handle more robustly various database numeric results during schema crawling.

## [3.8.3] - 2026-01-09
### Improvements & Refactoring
- **Unified SQL Introspectors**: Refactored the database introspection layer using a template-method pattern via `AbstractSqlSchemaIntrospector`. This consolidated shared logic for **PostgreSQL**, **MySQL**, **MariaDB**, and **SQLite**, reducing code duplication by ~280 lines while ensuring consistent behavior across all SQL dialects.
- **Enhanced `@Index` Decorator**: Completed the implementation for composite and customized indexes. Developers can now define multi-column indexes with support for custom `name`, `unique` constraints, and dialect-specific `type` (e.g., `btree`, `hash`, `gin`, `gist`) and `where` clauses.
- **Reliable Schema Generation**: Synced `SqlSchemaGenerator` with the **Schema AST** for initial `CREATE TABLE` operations. This ensures that manually defined composite indexes and complex constraints are automatically included in new migrations and `autoSync` actions.
- **Robust SQLite Introspection**: Optimized SQLite-specific PRAGMA handling to correctly manage non-standard placeholder support, resolving "Too many parameters" errors and improving stability for **LibSQL** and **Cloudflare D1**.
- **Refined Type Safety**: Fixed TypeScript compilation issues related to `override` modifiers and corrected internal type mismatches in `SchemaASTBuilder`, achieving a perfectly clean `tsc` output and 100% test coverage for all introspector modules.

## [3.8.2] - 2026-01-08
### Improvements & Refactoring
- **Refactored Dialect Configuration**: Grouped dialect-specific flags into a cohesive `features` object within `DialectConfig`. Introduced a new `foreignKeyAlter` flag to explicitly manage support for post-creation foreign key constraints, improving architectural clarity.
- **Enhanced Table Builder**: Foreign key definitions created via the fluent `.references()` API are now automatically promoted to table-level constraints during the build process. This ensures full compatibility with **SQLite** and other dialects that require foreign keys to be defined within the `CREATE TABLE` statement.
- **Predictable SQL Expressions**: Removed brittle string auto-detection in `formatDefaultValue`. Developers are now encouraged to use the explicit `raw()` helper or the `t.now()` shortcut for SQL expressions like `CURRENT_TIMESTAMP`, ensuring deterministic behavior across all databases.
- **Robust Introspection Tests**: Refactored the integration test suite to use explicit SQL expression helpers and non-shadowed callback parameters. Standardized timestamp type assertions for MySQL and MariaDB, achieving 100% pass rate across the entire test suite (1,383 tests).

## [3.8.0] - 2026-01-08
### Schema Sync System & AST Engine
- **Schema AST Feature**: Introduced a revolutionary **Schema AST (Abstract Syntax Tree)** engine that treats the database schema as a graph. This enables features like **Circular Dependency Detection** and automatic topological sorting for `CREATE`/`DROP` operations, solving complex schema edge cases that simple list-based approaches cannot handle.
- **Smart Relation Detection**: When scaffolding entities from an existing database (`generate:from-db`), UQL now automatically infers **OneToOne** and **ManyToMany** relationships by analyzing foreign key structures and naming conventions (e.g., `user_id` -> `User` entity), significantly reducing manual boilerplate.
- **Drift Detection**: Added the `drift:check` command to detect discrepancies between your TypeScript entities and the actual database schema. It reports critical issues (missing tables, risk of data truncation) and warnings (missing indexes) to ensure production safety.
- **Bidirectional Index Sync**: Indexes are now fully synchronized in both directions. `@Field({ index: true })` definitions are pushed to the database, and existing database indexes are reflected in generated entity files.
- **Unified Migration Builder API**: Refactored the migration builder to use a cohesive **Options Object** API (e.g., `t.string('email', { length: 255, unique: true })`). This replaces the old positional argument style, aligning strictly with the `@Field` decorator options for a consistent developer experience.
- **Refactored Generators**: Consolidated `SqlSchemaGenerator` and `MongoSchemaGenerator` into a unified architecture, sharing core logic for simpler maintenance and better type safety.

## [3.7.14] - 2026-01-06
### Documentation
- **README Refinement**: Improved docs about new Migrations feature.

## [3.7.12] - 2026-01-06
### Improvements
- **Expanded Float Support**: Added `float4`, `float8`, and `double precision` to `ColumnType`, with proper mapping across PostgreSQL, MySQL, and SQLite.
- **Type Grouping & Safety**: Introduced specialized union types (`NumericColumnType`, `StringColumnType`, `DateColumnType`, etc.) for better internal organization and exhaustive type checking.
- **Optimized Type Helpers**: Refactored `field.util.ts` to use `as const satisfies Record<T, true>` for all column type groups, ensuring compile-time verification when adding new types.
- **Dialect Refactoring**: Standardized SQL dialects to use centralized type helpers (`isNumericType`, `isJsonType`), improving code reuse and consistency.

## [3.7.11] - 2026-01-04
### Improvements
- **Enhanced Down Migrations**: `generateAlterTableDown` now generates complete reversals for column alterations (restores original type) and index additions (drops them). For dropped columns/indexes, a TODO comment is added since the original schema isn't stored.
- **Bun Documentation**: Added note in README for Bun users with TypeScript path aliases to use `--bun` flag for proper resolution.

## [3.7.10] - 2026-01-04
### Improvements
- **Robust Config Loading**: Integrated `jiti` into the CLI configuration loader. This allows `uql-migrate` to natively support TypeScript configuration files (`uql.config.ts`) and properly resolve ESM/CJS interop logic across all node environments (Node.js, Bun, etc.) without requiring custom runtime flags.

## [3.7.9] - 2026-01-04
- **Manual Migrations**: Updated the root README to explicitly document the `generate` command for creating manual incremental migrations (`npx uql-migrate generate <name>`), ensuring developers know how to create empty migration files efficiently.

### Bug Fixes
- **CLI Entry Point**: Fixed a critical issue where the `uql-migrate` command would silently fail in certain environments (e.g., when run via `npx` or symlinks) due to brittle entry point detection. The CLI now reliably executes regardless of how it is invoked.

 ## [3.7.7] - 2026-01-04
 ### Refined Foreign Key Handling & Control
 - **Recursive Type Inheritance**: Foreign key columns now automatically inherit the exact SQL type of their referenced primary keys (e.g., `UUID` -> `UUID`), ensuring perfect compatibility even in complex inheritance or self-referencing relationships.
 - **Custom Foreign Key Control**: Introduced the `foreignKey` option in `@Field` and `@Id` to allow specifying custom semantic names for constraints or disabling physical constraints (`false`) while maintaining logical references.
 - **Deterministic Constraint Naming**: Standardized default foreign key naming to `` `fk_${tableName}_${columnName}` ``, ensuring uniqueness and predictability across the database.
 - **Enhanced Schema Robustness**: Improved the schema generator's resilience against entities using circular dependencies or deep inheritance chains.
 - **Express Middleware Fix**: Resolved an issue in `query.util.ts` where the query parser could crash when receiving array-based query parameters (e.g., `$where[]=1`), preventing correct filtering in Express applications.
 - **Field Utility Optimization**: Refactored `isNumericType` to use a `Set` for O(1) lookups and resolved strict type checking issues in `field.util.ts`.

 ## [3.7.5] - 2026-01-04
 ### Enhanced Type Inference & Default Value Comparison
 - **Strict Field Type Safety**: Standardized the `type` property in `@Field` and `@Id` to use a strict union of global constructors (`String`, `Number`, etc.) and verified `ColumnType` strings.
 - **Removed String Aliases**: Deprecated and removed support for informal string aliases like `'string'`, `'number'`, `'boolean'`, and `'date'` in the `type` property. Developers should use the corresponding TypeScript constructors for logical mapping.
 - **Semantic Type Inference**: Added robust support for `'uuid'`, `'json'`, `'jsonb'`, and `'vector'` as valid semantic values for the `type` property. This ensures correct cross-database SQL mapping even when specified as semantic strings.

 ## [3.7.4] - 2026-01-04
 ### Enhanced Schema Generation & Type Safety
 - **Fixed Foreign Key Type Mismatch**: Resolved an issue where foreign key columns could default to incompatible types (e.g., `TEXT`) when referencing primary keys of a different type (e.g., `UUID`). Foreign keys now automatically inherit the exact SQL type of the column they reference.
 - **Improved Default Value Comparison**: Standardized default value normalization to handle complex PostgreSQL type casts (e.g., `'[]'::jsonb[]`) and accurately compare object/array defaults using `JSON.stringify`, effectively eliminating "phantom diffs."
 - **Improved Primary Key Inference**: String-based primary keys (including UUIDs) no longer incorrectly default to `BIGINT` auto-incrementing serials. The ORM now only applies auto-increment logic to numeric types (`number`, `BigInt`) unless explicitly configured via `@Id({ autoIncrement: true })`.
 - **Architectural Refactor**: Consolidated schema generation to use a unified `fieldToColumnSchema` path for both initial creation and synchronization, ensuring perfect structural consistency and eliminating "phantom diffs".
 - **Reusable Field Utilities**: Created `field.util.ts` for centralized logic regarding auto-increment and numeric type checks, improving maintainability across the ORM.
 - **Safety Fix**: Refined `generateColumnDefinitionFromSchema` to safely strip redundant `PRIMARY KEY` constraints during `ALTER TABLE` operations, avoiding "Duplicate Primary Key" errors while maintaining auto-incrementing properties.
 - **Expanded Unit Tests**: Added comprehensive branch testing for field properties and type inference to ensure long-term stability across all 8 supported databases.

 ## [3.7.3] - 2026-01-04
### Robust Schema Synchronization
- **Safe AutoSync**: Primary keys are now immune to automated alterations, preventing dangerous schema changes and ensuring database stability.
- **Modern Primary Keys**: Standardized on **64-bit** auto-increment primary keys across all SQL dialects to align with TypeScript's `number` type:
  - **PostgreSQL**: Now uses `BIGINT GENERATED BY DEFAULT AS IDENTITY` (SQL Standard).
  - **MySQL / MariaDB**: Now uses `BIGINT UNSIGNED AUTO_INCREMENT`.
  - **SQLite / LibSQL / D1**: Consistently uses 64-bit `INTEGER PRIMARY KEY`.
- **SQLite `STRICT` Mode**: Tables generated for SQLite, LibSQL, and Cloudflare D1 now use **`STRICT` mode** by default, enforcing type integrity at the database level.
- **Polymorphic Type Resolution**: Refactored `getSqlType` to be dialect-aware for all core types (Numbers, Strings, Booleans, Dates), preventing dialect-specific types from leaking into incompatible databases.
- **Semantic Type Comparison**: Implemented intelligent type normalization that understands dialect-specific aliases (e.g., `INTEGER` vs `INT`) and ignores implementation details like MySQL display widths (`BIGINT(20)`).
- **Fixed ALTER Syntax**: Resolved "Duplicate primary key" errors in MySQL/MariaDB by ensuring `MODIFY COLUMN` statements omit existing constraints during type or nullability updates.
- **Improved Postgres Introspection**: Enhanced default value comparison to correctly handle complex Postgres type casts (e.g., `::timestamp without time zone`) and quoted strings.
- **Expanded Testing**: Added **SQLite**, **LibSQL**, and **Cloudflare D1** scenarios to the integration test suite, ensuring 100% behavioral consistency across all 8 supported databases.
- **Predictable Test Assertions**: Refactored all schema synchronization and introspection tests to use direct, non-conditional assertions, improving test reliability and failure clarity by removing optional chaining and non-null assertions.
- **Clean Test Logic**: Removed imperative conditionals from test generators, replacing them with declarative mapping objects for dialect-specific type verification.

## [3.7.2] - 2026-01-04
### Improve documentation
- **AutoSync**: Clarified that entities must be imported/loaded before calling `autoSync()`. Added examples for both explicit entity passing (recommended) and auto-discovery approaches, plus debugging tips

## [3.7.1] - 2026-01-04
### Improve documentation
- Update examples in docs and improve formatting of README

## [3.7.0] - 2026-01-04
### Improvements
- **Repository Pattern Removal**: Removed the built-in Repository pattern implementation (`GenericRepository`, etc.) to simplify the framework architecture (KISS). Users should rely on the `Querier` interface or implement custom layers if needed.
- **Testing**: Added comprehensive tests for `HttpQuerier` and integration tests for the CLI entry point (`bin.ts`), achieving >99% code coverage.

## [3.6.1] - 2026-01-04
### New Features
- **CLI**: Added `--config` / `-c` flag to `uql-migrate` to load a custom configuration file.
- **CLI**: Improved error handling when loading configuration files (syntax errors are no longer swallowed).

## [3.6.0] - 2026-01-04
### New Features
- **CLI**: Added default logger, support to log slow-queries in a parameterized way, and ability to define custom loggers.

## [3.5.0] - 2026-01-03
### Refactor
- **Dialect-Aware String Defaults**: Optimized default column types for TypeScript `string` fields across all supported databases.
  - **PostgreSQL**: Defaults to `TEXT` (idiomatic, no length limits, slightly faster).
  - **SQLite**: Defaults to `TEXT` (matches internal type affinity).
  - **MySQL / MariaDB**: Defaults to `VARCHAR(255)` (ensures out-of-the-box compatibility for indices and unique constraints).
  - Automatically transitions to `VARCHAR(n)` when an explicit `length` is provided in the `@Field()` decorator.

## [3.4.1]
### Improve documentation

- Update examples in docs

## [3.1.1](https://github.com/rogerpadilla/uql/compare/uql-orm@3.1.0...uql-orm@3.1.1) (2025-12-30)
### Bug Fixes
* adjust relative paths for README and CHANGELOG in copyfiles script ([741c2ee](https://github.com/rogerpadilla/uql/commit/741c2ee8839376ca89a860a53950ef6b6d234596))

## [3.1.0](https://github.com/rogerpadilla/uql/compare/uql-orm@3.0.0...uql-orm@3.1.0) (2025-12-30)
### Bug Fixes

* adjust relative paths for README and CHANGELOG in copyfiles script ([7a61a01](https://github.com/rogerpadilla/uql/commit/7a61a0135da2d0459e588cda7d94f324bb9eebca))

## [3.0.0](https://github.com/rogerpadilla/uql/compare/uql-orm@2.0.0...uql-orm@3.0.0) (2025-12-30)
Reflect major changes in the package structure and dependencies.

## [2.0.0] - 2025-12-29
- **Major Rebranding**: Rebranded the project from **Nukak** to **UQL** (Universal Query Language - this was the original name!).
  - New Slogan: **"One Language. Frontend to Backend."**
  - Project homepage: [uql-orm.dev](https://uql-orm.dev).
- **Package Unification**: Unified all database adapters (`mysql`, `postgres`, `maria`, `sqlite`, `mongo`) and `express` middleware into a single core package: `uql-orm`.
- **Scoped Naming**:
  - `uql-orm`: The main ORM engine and all database adapters.
  - `uql-orm/migrate`: The database migration system (formerly `nukak-migrate`).
- **Improved API Surface**:
  - Database-specific logic is now accessible via sub-paths (e.g., `import { ... } from 'uql-orm/postgres'`).
  - Unified `NamingStrategy` and `QueryContext` across all unified adapters.
- **Build & Distribution**:
  - Integrated `bunchee` for high-performance browser bundle generation (`uql-orm/browser`).
  - Minimized core dependency footprint by moving database drivers to optional `peerDependencies`.
- **Enhanced Type Safety**: Fully updated internal type resolution to support the unified package structure.

## [1.8.0] - 2025-12-29
- **New Feature**: Added support for **Naming Strategies**.
  - Automatically translate TypeScript entity and property names to database-specific identifiers (e.g., camelCase to snake_case).
  - Built-in `DefaultNamingStrategy` and `SnakeCaseNamingStrategy`.
  - Comprehensive support across all SQL dialects and MongoDB.
- **Refactoring**:
  - Unified naming and metadata resolution logic into a new `AbstractDialect` base class shared by both DML (Dialects) and DDL (Schema Generators).
  - Improved `MongoDialect` to respect naming strategies for collection and field names on both read and write operations.

## [1.7.0] - 2025-12-29
- **New Package**: Introduced `nukak-migrate` for database migrations.
  - Supports version-controlled schema changes via local migration files.
  - Automatic migration generation from entity definitions using schema introspection.
  - Full support for PostgreSQL, MySQL, MariaDB, and SQLite.
  - CLI tool for managing migrations (`up`, `down`, `status`, `generate`, `sync`).
  - Database-backed migration tracking (Database or JSON storage).
- **Core Improvements**:
  - Expanded `@Field()` decorator with schema metadata: `length`, `precision`, `scale`, `unique`, `index`, `columnType`, `defaultValue`, and `comment`.
  - Added schema generation and introspection capabilities to SQL dialects.

## [1.6.0] - 2025-12-28
- **Architectural Change**: Migrated from "Values as Parameter" to "Context Object" pattern for SQL generation.
  - This pattern centralizes query parameters and SQL fragments into a `QueryContext`, ensuring robust placeholder management and preventing out-of-sync parameter indices.
  - Improved compatibility with PostgreSQL's indexed placeholders ($1, $2, etc.) and complex sub-queries.
  - Standardized dialect interfaces to operate directly on the `QueryContext` for higher performance and cleaner code.
- Fixed linter issues and unified type safety for `raw()` SQL snippets across all drivers.

## [1.5.0] - 2025-12-28
- **BREAKING CHANGE**: Implemented "Sticky Connections" for performance. `Querier` instances now hold their connection until `release()` is explicitly called.
  - If you manually retrieve a querier via `pool.getQuerier()`, you **MUST** call `await querier.release()` when finished, otherwise connections will leak.
  - `Repositories` and `pool.transaction(...)` callbacks automatically handle this, so high-level usage remains unchanged.
- Unified serialization logic: `@Serialized()` decorator is now centralized in `AbstractSqlQuerier`, removing redundant overrides in drivers.
- Fixed MongoDB consistency: `beginTransaction`, `commitTransaction`, and `rollbackTransaction` are now serialized to prevent race conditions.
- Fix Cross-Dialect SQL JSON bug by moving PostgreSQL-specific casts to the appropriate dialect.
- Fix transaction race conditions by serializing transaction lifecycle methods and implementing an internal execution pattern.

## [1.4.16] - 2025-12-28

- Implement a "Serialized Task Queue" at the core of the framework to ensure database connections are thread-safe and race-condition free.
- Introduce `@Serialized()` decorator to simplify the serialization of database operations across all drivers.

## [1.4.14] - 2025-12-28

- Robust `upsert` implementation across all SQL dialects (PostgreSQL, MySQL, MariaDB, SQLite).

## [1.4.10] - 2025-12-27

- Improve types, tests, migrate from EsLint/Prettier to Biome, and update dependencies.

## [1.4.6] - 2024-11-06

- Update dependencies and improve readme.

## [1.4.5] - 2024-09-26

- Imperative transactions have to be closed manually.

## [1.4.4] - 2024-09-26

- Ensure own connection is always released even if exception occurs.
- Correct issue when empty or null list is passed to `insertMany` operations.

## [1.4.3] - 2024-09-25

- Ensure the connection is auto-released after `commit` or `rollback` runs.
- Update dependencies.

## [1.4.2] - 2024-09-20

- Fix projection of `@OneToMany` field when the 'one' side produces empty result.
- Update dependencies.

## [1.4.1] - 2024-08-21

- Add nukak-maku logo.
- Update dependencies (functionality keeps the same in this release).

## [1.4.0] - 2024-08-15

- Automatically release the querier unless it is inside a current transaction.
- Remove unnecessary wrapper for transactions from `AbstractQuerierPool` class.

## [1.3.3] - 2024-08-13

- Improve typings of first inserted ID.

## [1.3.2] - 2024-08-13

- Return the inserted IDs in the response of the queriers' `run` function.

## [1.3.1] - 2024-08-13

- Fix an issue related to the `$where` condition of selected relations missed in the final criteria for `@OneToMany` and `@ManyToMany` relationships.

## [1.3.0] - 2024-08-13

- Add support for `json` and `jsonb` fields. Automatically parse the JSON values when persisting with `JSON.parse` function.
- Improve type-safety in general.
- Move `getPersistables` inside dialect for higher reusability.
- Add support for `vector` fields.

## [1.2.0] - 2024-08-12

- Add support for `raw` in values (previously, it was only supported by `$select` and `$where` operators). Allows safe use of any SQL query/clause as the value in an insert or update operation that shouldn't be automatically escaped by the ORM.

## [1.1.0] - 2024-08-11

- Add support for `upsert` operations.
- Migrate SQLite package driver from `sqlite3` to `better-sqlite3` for better performance.
- Make Maria package to use the `RETURNING id` clause to get the inserted IDs.

## [1.0.1] - 2024-08-10

- Rename `$project` operator to `$select` for consistency with most established frameworks so far.
- Rename `$filter` operator to `$where` for consistency with most established frameworks so far.

## [1.0.0] - 2024-08-10

- Allow to set a field as non-eager (i.e. lazy) with `eager: false` (by default fields are `eager: true`).
- Allow to set a field as non-updatable (i.e. insertable and read-only) with `updatable: false` (by default fields are `updatable: true`).

## [0.4.0] - 2023-11-06

- Move project inside query parameter [#63](https://github.com/rogerpadilla/nukak/pull/63)

## [0.3.3] - 2023-10-25

- Update usage example in the README.md.

## [0.3.2] - 2023-10-24

- Improve usage examples in the README.md, and make the overview section more concise.

## [0.3.1] - 2023-10-19

1. Remove `$group` and `$having` as they detriment type safety as currently implemented (support may be redesigned later if required).
2. Improve type safety of `$project` operator.
3. Improve type safety of `$filter` operator.
4. Remove projection operators (`$count`, `$min`, `$max`, `$min`, and `$sum`) as they detriment type safety as currently implemented. This can be done via Virtual fields instead as currently supported for better type safety.

## [0.3.0] - 2023-10-18

- Add support for `transaction` operations using a QuerierPool.
  Automatically wraps the code of the callback inside a transaction, and auto-releases the querier after running.
- Update dependencies.

  ```ts
  const ids = await pool.transaction(async (querier) => {
    const data = await querier.findMany(...);
    const ids = await querier.insertMany(...);
    return ids;
  });
  ```

## [0.2.21] 2023-04-15

- fix(nukak-browser): check if ids are returned before use $in to delete them.

- Reuse community open-source npm packages to escape literal-values according to each DB vendor.

## [0.2.0] 2023-01-02

- Move projection to a new parameter to improve type inference of the results.

- Support dynamic operations while projecting fields, and move `$project` as an independent parameter in the `find*` functions [#55](https://github.com/rogerpadilla/nukak/pull/55).
