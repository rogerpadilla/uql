# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.9.3](https://github.com/rogerpadilla/uql/compare/uql-orm@0.9.1...uql-orm@0.9.3) (2026-06-28)


### Bug Fixes

* cache parsed query to survive Express req.query getter re-invocation ([ee934eb](https://github.com/rogerpadilla/uql/commit/ee934ebe9f32a11307e46535d2407bbbf604dcaa))
* narrow meta.id in closure and add 0.9.2 changelog entry ([9fb427b](https://github.com/rogerpadilla/uql/commit/9fb427baf78d7987977a8b4c40bfee587a022e46))


### Features

* add tests for $limit and $where query parameters in querierMiddleware ([7fe4ff3](https://github.com/rogerpadilla/uql/commit/7fe4ff3170167180b655c0aac3a286bfa5c91336))





## 0.9.2 (2026-06-10)


### Bug Fixes

* 86-87-migration-codegen-libsql ([b262a82](https://github.com/rogerpadilla/uql/commit/b262a827b2014118cfe615bcaf9bb17ea7e41a26))
* bug fixes and test improvements for JSON handling ([3c5e1a6](https://github.com/rogerpadilla/uql/commit/3c5e1a67796810e7374a7c74256b531b1a5004d2))
* cache parsed query to survive Express req.query getter re-invocation ([ee934eb](https://github.com/rogerpadilla/uql/commit/ee934ebe9f32a11307e46535d2407bbbf604dcaa))
* correct dialect inference logic by reordering adapter check in inferDialect function ([2ad59ab](https://github.com/rogerpadilla/uql/commit/2ad59ab97b01a0a4c5809ba504bb575b78f5e4d8))
* Correct row parsing for underscore columns and improve SQL query generation and row parsing performance. ([aab7c2a](https://github.com/rogerpadilla/uql/commit/aab7c2aba1dde4a87d3037d5d0fc23c386b7f7c1))
* correct upsert  field semantics and refactor  to accept variadic ([363283a](https://github.com/rogerpadilla/uql/commit/363283a6cea5fbae343fb8162aa33e2568a6bc91))
* Correct virtual field alias generation in `getRawValue` by ensuring proper dot separators and removing stale underscore replacement, with added tests for regression prevention. ([4071dd0](https://github.com/rogerpadilla/uql/commit/4071dd0f9f0b453a235cb75d1889a497417995d7))
* corrected issue related to bun sql imports ([70a66a9](https://github.com/rogerpadilla/uql/commit/70a66a9753df1c63cf9a24dc32cf53e5993833d7))
* Correctly generate `EXISTS` subqueries for ManyToOne and OneToOne relation filtering in `$where` clauses and add querier listener tests. ([4c7e97a](https://github.com/rogerpadilla/uql/commit/4c7e97a08efe62a61735f7e9f61478b43511e2ae))
* enhance normalizeRows function to preserve row references for non-bigint values and clone rows with bigints for accurate normalization ([f5850ca](https://github.com/rogerpadilla/uql/commit/f5850caa2dd03a54ec184c9fa6ada8f2617a33b1))
* improve dialect inference in inferDialect function by refining type checks for SQLite and adapter handling ([7a314b8](https://github.com/rogerpadilla/uql/commit/7a314b8bab20e496a927e0b396373085e4e7ac40))
* narrow meta.id in closure and add 0.9.2 changelog entry ([9fb427b](https://github.com/rogerpadilla/uql/commit/9fb427baf78d7987977a8b4c40bfee587a022e46))
* update changelog version from 0.3.0 to 0.2.1. ([3768858](https://github.com/rogerpadilla/uql/commit/3768858b532454bae5a28777b4313e2bea52aa31))
* update type casting in bunSql utility tests to ensure proper handling of Postgres options and maintain SSL mode stripping functionality ([e42a756](https://github.com/rogerpadilla/uql/commit/e42a756cd74b8b60a6a17e6e927321e2628e1bee))


### Features

* add  to  and implement  created/updated detection for MongoDB, MariaDB, MySQL, and PostgreSQL ([e093f34](https://github.com/rogerpadilla/uql/commit/e093f343bc9635b861c3674c6a9633b880adabef))
* Add Bun SQL querier with connection pooling, enhance primary key handling, and improve JSON path escaping in dialects. ([386b878](https://github.com/rogerpadilla/uql/commit/386b8786eecbd9c89d66c7ca5497b62a43693e40))
* Add Bun SQL support and refactor querier pools to directly use dialect instances. ([4a94732](https://github.com/rogerpadilla/uql/commit/4a9473246566bba052cd608e06c8d59ae4a95b96))
* add CockroachDB support with a new dialect, querier, and Docker Compose configuration, extending PostgreSQL's base implementation. ([34b94e5](https://github.com/rogerpadilla/uql/commit/34b94e5ed25fa5e68a0ab868085bb8a157990574))
* Add CockroachDB support with native upsert and mapped driver execution. ([2b2538e](https://github.com/rogerpadilla/uql/commit/2b2538e2d6317a4729342c794cce73e6229ab038))
* Add Fullstack Bridge and Semantic Search features to README and refine AST cloning test. ([1ebc575](https://github.com/rogerpadilla/uql/commit/1ebc57578d78b2fff12526b1d10ee9d30415c86f))
* Add isolation level support to `@Transactional` and `pool.transaction`, and enable transaction reuse for nested calls. ([4c0bad5](https://github.com/rogerpadilla/uql/commit/4c0bad5265509e60a742982da2606b1c56024484))
* Add SVG drawing animations to the full logo and update the README to display it. ([4515203](https://github.com/rogerpadilla/uql/commit/45152032021b2a21ee4bbdf74cc3a48097003cb4))
* add tests for $limit and $where query parameters in querierMiddleware ([7fe4ff3](https://github.com/rogerpadilla/uql/commit/7fe4ff3170167180b655c0aac3a286bfa5c91336))
* Add tests for Bun SQL dialects (MariaDB, MySQL, Postgres) and enhance utility functions for value normalization and result handling. ([cd12cbc](https://github.com/rogerpadilla/uql/commit/cd12cbcc176dfdf3ad32636bbc4c93ed23785ca4))
* Add transaction isolation level support to SQL dialects and queriers. ([0ee285a](https://github.com/rogerpadilla/uql/commit/0ee285ab0f52e480631a80a8237c6cc95e1a55ae))
* add vector search integration tests for `findMany` with `$sort: { $vector }` and update test infrastructure. ([c920cde](https://github.com/rogerpadilla/uql/commit/c920cde46dbb4985d07a1926dfc3ac845862244c))
* **core:** introduce decorator-free entity definition ([d2d02ef](https://github.com/rogerpadilla/uql/commit/d2d02efd1c371a0b66ec80f0bc00678c80628bf4))
* enhance $size operator to support comparison objects for array lengths and relation counts. ([02037fb](https://github.com/rogerpadilla/uql/commit/02037fbb6113efab9d23c9809370704b2de3747a))
* Enhance Bun SQL dialect detection, add type safety to entity metadata tests, and update dependencies. ([0116fdc](https://github.com/rogerpadilla/uql/commit/0116fdcbba15314c329171b2426333113dee08c7))
* enhance JSON update capabilities and improve documentation ([47aab39](https://github.com/rogerpadilla/uql/commit/47aab39a18307a57fa71cfd44fb489d9835fbc10))
* enhance type safety across various modules, fix a typo in IsolationLevel, and refine error handling ([2631d0b](https://github.com/rogerpadilla/uql/commit/2631d0b5cfa8ce6130e3834a60e3820b83d7404b))
* implement aggregate query API with `$group`, `$having`, and `$distinct` support, accompanied by sorting bug fixes and extensive code refactoring. ([fa90ee9](https://github.com/rogerpadilla/uql/commit/fa90ee9313645179c4d7d1ec2e4ec291dfe7285b))
* implement cursor-based stream with  across all queriers and deprecate  in favor of ([2d6c2ea](https://github.com/rogerpadilla/uql/commit/2d6c2ea0851d9c20ca9d092717087eaa65e5f937))
* implement cursor-based stream with  across all queriers and deprecate  in favor of ([536b67b](https://github.com/rogerpadilla/uql/commit/536b67b6bb0ab8024449f557a83c43a3b4f09fb5))
* implement MongoDB vector search functionality in dialect and querier ([2987574](https://github.com/rogerpadilla/uql/commit/2987574eaa10efc201ec17d0b6f72a144a1b49fb))
* Implement not-equal operator handling across SQL dialects, enhancing compatibility for null-safe comparisons and updating related tests. ([88c164a](https://github.com/rogerpadilla/uql/commit/88c164a45e34223551919a9fa11ffd6283081b9b))
* implement robust SQL statement splitting using a declarative regex scanner to handle complex syntax and comments ([fe91618](https://github.com/rogerpadilla/uql/commit/fe916189e75645ab47999441d62b0ac9cf536d6e))
* Introduce a new cursive "U" logo in SVG, PNG, and JPG formats, and update package dependencies. ([073239b](https://github.com/rogerpadilla/uql/commit/073239b2342eecc96b15f5099d0f9b18a7a4cf23))
* Introduce aggregate query support with `GROUP BY`, `HAVING`, `$count`, `$sum`, `$avg`, `$min`, `$max`, and `DISTINCT` across all dialects. ([2ba02e9](https://github.com/rogerpadilla/uql/commit/2ba02e9070c8a457a651507cd55ee8e94e22819e))
* redesign logo and add JPG and PNG formats. ([7f921a0](https://github.com/rogerpadilla/uql/commit/7f921a0f306997dfce36455a35513bde9b66f462))
* upgrade to Vite 8 and TypeScript 6, removing redundant compiler options and `vite-tsconfig-paths` plugin. ([f81563c](https://github.com/rogerpadilla/uql/commit/f81563cfe5246bfa59966f08493fd9786a817e02))
* vector index support with dialect-driven schema generation ([5bb1a6e](https://github.com/rogerpadilla/uql/commit/5bb1a6e99ae9108dad492630c55cf3ba15862a3c))


### Performance Improvements

* Optimize query context length tracking, SQL identifier escaping, and `WHERE` clause generation logic for improved performance. ([cc4d40d](https://github.com/rogerpadilla/uql/commit/cc4d40dd08d949260998b97fa60ea1cfa4b97887))
* Optimize SQL query generation by reusing regex patterns, short-circuiting relation detection, and incrementally tracking SQL length. ([0568e52](https://github.com/rogerpadilla/uql/commit/0568e52ef691e54edb3a5bd7cd5a9fc2a5a013d3))
* Reduce allocations and simplify logic in utility functions and SQL query generation. ([5bc1ed5](https://github.com/rogerpadilla/uql/commit/5bc1ed5d85b91ba4af96075a91c93c923a204e76))
