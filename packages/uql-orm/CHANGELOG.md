# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.10.1](https://github.com/rogerpadilla/uql/compare/uql-orm@0.9.1...uql-orm@0.10.1) (2026-07-03)


### Bug Fixes

* **build:** remove shared root tsBuildInfoFile, verify dist before pack ([a05cbf8](https://github.com/rogerpadilla/uql/commit/a05cbf83851396089236b6091321d0d86788fdda))
* cache parsed query to survive Express req.query getter re-invocation ([f5c1b11](https://github.com/rogerpadilla/uql/commit/f5c1b11191fd581734972a9d208ed2b8b0e0f174))
* enhance prepack script and update tsconfig for build info ([4895db1](https://github.com/rogerpadilla/uql/commit/4895db14811cccb8628d3b5d8516b34e3bc6e676))
* narrow meta.id in closure and add 0.9.2 changelog entry ([98fd681](https://github.com/rogerpadilla/uql/commit/98fd6819d7ecdc7aeeef0e0cc0bb7ea10ada8cd7))


* feat(http)!: framework-agnostic HTTP transport core (uql-orm/http) ([2d64a28](https://github.com/rogerpadilla/uql/commit/2d64a285ce904f8ab77be03224e3ae7a683e1639))


### Features

* add tests for $limit and $where query parameters in querierMiddleware ([7fe4ff3](https://github.com/rogerpadilla/uql/commit/7fe4ff3170167180b655c0aac3a286bfa5c91336))
* **nestjs:** end the pool on application shutdown ([8f9f0bb](https://github.com/rogerpadilla/uql/commit/8f9f0bb7eb9679c5c0c048b07e466756028edd2a))


### BREAKING CHANGES

* hook signature is (ctx: HookContext); error envelope is
{ error: { message, code } }; HttpQuerier.saveOne issues PUT; removed
buildQuerierRouter, express parseQuery, the browser re-exports, and the
dead uql-orm/test export; uql-orm/browser no longer loads reflect-metadata.
