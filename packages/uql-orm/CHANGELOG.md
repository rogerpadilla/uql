# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.10.0](https://github.com/rogerpadilla/uql/compare/uql-orm@0.9.5...uql-orm@0.10.0) (2026-07-03)


* feat(http)!: framework-agnostic HTTP transport core (uql-orm/http) ([8e1565d](https://github.com/rogerpadilla/uql/commit/8e1565da53f6140751c41ec99d4f0a23742ebf09))


### BREAKING CHANGES

* hook signature is (ctx: HookContext); error envelope is
{ error: { message, code } }; HttpQuerier.saveOne issues PUT; removed
buildQuerierRouter, express parseQuery, the browser re-exports, and the
dead uql-orm/test export; uql-orm/browser no longer loads reflect-metadata.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
