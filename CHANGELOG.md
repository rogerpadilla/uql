# Changelog

All notable changes to this project will be documented in this file. Please add new changes to the top.

date format is [yyyy-mm-dd]

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
