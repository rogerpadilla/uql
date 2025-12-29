# Changelog

All notable changes to this project will be documented in this file. Please add new changes to the top.

date format is [yyyy-mm-dd]
## [2.0.0] - 2025-12-29
- **Major Rebranding**: Rebranded the project from **Nukak** to **UQL** (Universal Query Language - this was the original name!).
  - New Slogan: **"One Language. Frontend to Backend."**
  - Project homepage: [uql.app](https://uql.app).
- **Package Unification**: Unified all database adapters (`mysql`, `postgres`, `maria`, `sqlite`, `mongo`) and `express` middleware into a single core package: `@uql/core`.
- **Scoped Naming**:
  - `@uql/core`: The main ORM engine and all database adapters.
  - `@uql/migrate`: The database migration system (formerly `nukak-migrate`).
- **Improved API Surface**:
  - Database-specific logic is now accessible via sub-paths (e.g., `import { ... } from '@uql/core/postgres'`).
  - Unified `NamingStrategy` and `QueryContext` across all unified adapters.
- **Build & Distribution**:
  - Integrated `bunchee` for high-performance browser bundle generation (`@uql/core/browser`).
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
  const ids = await querierPool.transaction(async (querier) => {
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
