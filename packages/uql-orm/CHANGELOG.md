# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.7.1](https://github.com/rogerpadilla/uql/compare/uql-orm@0.7.1...uql-orm@0.7.1) (2026-03-26)


### Bug Fixes

* correct dialect inference logic by reordering adapter check in inferDialect function ([2ad59ab](https://github.com/rogerpadilla/uql/commit/2ad59ab97b01a0a4c5809ba504bb575b78f5e4d8))
* enhance normalizeRows function to preserve row references for non-bigint values and clone rows with bigints for accurate normalization ([f5850ca](https://github.com/rogerpadilla/uql/commit/f5850caa2dd03a54ec184c9fa6ada8f2617a33b1))
* improve dialect inference in inferDialect function by refining type checks for SQLite and adapter handling ([7a314b8](https://github.com/rogerpadilla/uql/commit/7a314b8bab20e496a927e0b396373085e4e7ac40))
* update type casting in bunSql utility tests to ensure proper handling of Postgres options and maintain SSL mode stripping functionality ([e42a756](https://github.com/rogerpadilla/uql/commit/e42a756cd74b8b60a6a17e6e927321e2628e1bee))


### Features

* Add tests for Bun SQL dialects (MariaDB, MySQL, Postgres) and enhance utility functions for value normalization and result handling. ([cd12cbc](https://github.com/rogerpadilla/uql/commit/cd12cbcc176dfdf3ad32636bbc4c93ed23785ca4))
* Implement not-equal operator handling across SQL dialects, enhancing compatibility for null-safe comparisons and updating related tests. ([88c164a](https://github.com/rogerpadilla/uql/commit/88c164a45e34223551919a9fa11ffd6283081b9b))
