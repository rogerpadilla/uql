<div align="center">

<a href="https://uql-orm.dev">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rogerpadilla/uql/main/assets/logo-dark.svg">
    <img src="https://raw.githubusercontent.com/rogerpadilla/uql/main/assets/logo.svg" alt="UQL" width="72" height="72">
  </picture>
</a>

<h3>The JSON-native TypeScript ORM</h3>

<p align="left">UQL (Unified Query Language) queries SQL databases and MongoDB with plain, type-safe JSON, in a syntax inspired by MongoDB's.
</p>

<p>
  <a href="https://uql-orm.dev"><b>Website</b></a> ·
  <a href="https://uql-orm.dev/getting-started">Quick Start</a> ·
  <a href="https://uql-orm.dev/benchmark">Benchmark</a> ·
  <a href="https://uql-orm.dev/comparison">Compare ORMs</a> ·
  <a href="https://uql-orm.dev/blog/in-search-of-the-perfect-orm">Blog</a>
</p>

[![tests](https://github.com/rogerpadilla/uql/actions/workflows/tests.yml/badge.svg)](https://github.com/rogerpadilla/uql/actions/workflows/tests.yml)
[![Coverage Status](https://coveralls.io/repos/github/rogerpadilla/uql/badge.svg?branch=main)](https://coveralls.io/github/rogerpadilla/uql?branch=main)
[![npm version](https://img.shields.io/npm/v/uql-orm.svg)](https://www.npmjs.com/package/uql-orm)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/rogerpadilla/uql/blob/main/LICENSE.md)

</div>

---

```sh
npm install uql-orm pg   # or mysql2, mariadb, better-sqlite3, mongodb, @tursodatabase/serverless, @libsql/client
```

That is the whole install ([setup](https://uql-orm.dev/getting-started)). No compiler flags and no `reflect-metadata`; the decorators are the [TC39 standard spec](https://uql-orm.dev/entities/basic), and plain classes work too, via [`defineEntity`](https://uql-orm.dev/entities/imperative).

<a href="https://uql-orm.dev">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://uql-orm.dev/demo-dark.webp">
    <img src="https://uql-orm.dev/demo-light.webp" alt="A UQL query being typed: the compiler underlines the misspelled 'emial', then 'titel' three levels deep inside $populate, then '$like' on a numeric column">
  </picture>
</a>

The compiler catches each of those, with no codegen: the entity classes are the schema. Try the editor [on the home page](https://uql-orm.dev).

## Why UQL?

- **Queries are JSON, not method chains.** Build one dynamically, store it, or send it from the browser; the same object runs on every database. No DSL to learn.
- **One API, everywhere it runs.** PostgreSQL, PGlite, CockroachDB, MySQL, MariaDB, MSSQL, SQLite, Turso, libSQL, Neon, Cloudflare D1, Bun's native SQL, and even MongoDB. The same code on Node 24+, Bun, Deno, [Cloudflare Workers](https://uql-orm.dev/cloudflare-d1), [AWS Lambda and Vercel](https://uql-orm.dev/serverless), and [the browser](https://uql-orm.dev/browser), with no native binaries on the `fetch`-based drivers.
- **Type-safe to the leaf, nothing to generate.** Every key is checked against your entity, down into populated relations and [JSON/JSONB](https://uql-orm.dev/querying/json) dot-paths, so `$like` on a numeric column is a compile error. No `.prisma` file, no generated client.
- **Relations without N+1.** [`$populate`](https://uql-orm.dev/querying/relations) reads a to-many inside the parent's statement, so a read is one round trip. Nothing is lazy, so nothing fires behind your back in a serializer.
- **Migrations you read before they run.** Edit an entity, run `uql-migrate generate:entities`, review the SQL in the PR like any other file. [`drift:check`](https://uql-orm.dev/migrations) catches a database that no longer matches.
- **Raw SQL when you want it.** [`raw()`](https://uql-orm.dev/querying/raw-sql) fits anywhere in a query, [computed fields](https://uql-orm.dev/entities/computed-fields) are expressions you can filter on, and a migration can be plain SQL.
- **Light.** Zero runtime dependencies and every dialect in one package, yet `uql-orm/postgres` is about 27 kB gzipped. See [what we deleted to get there](https://uql-orm.dev/blog/zero-dependencies).
- **The hard things are built in.** [Semantic and vector search](https://uql-orm.dev/ai-semantic-search), [multi-tenant filters you cannot bypass by accident](https://uql-orm.dev/multi-tenancy), [soft-delete with restore](https://uql-orm.dev/entities/soft-delete), [streaming](https://uql-orm.dev/querying/streaming), and [a REST API from your entities](https://uql-orm.dev/http).
- **The fastest ORM.** On a full PostgreSQL round trip it adds the least over hand-written driver code of any ORM in our open-source [benchmark](https://github.com/rogerpadilla/ts-orm-benchmark), on Bun, Node and Deno alike. The same benchmark [scores the types](https://github.com/rogerpadilla/ts-orm-benchmark#type-safety) by compiling ordinary mistakes in each ORM's API: UQL is the only one that catches them all.

## Get started

**[uql-orm.dev](https://uql-orm.dev)** has the full docs. Good places to start:

- [Quick Start](https://uql-orm.dev/getting-started) - install, define an entity, run a query
- [Querying](https://uql-orm.dev/querying/querier) - operators, relations, aggregates, transactions
- [Entities](https://uql-orm.dev/entities/basic) - decorators, relations, hooks, or the decorator-free [imperative API](https://uql-orm.dev/entities/imperative)
- [Switching to UQL](https://uql-orm.dev/switching-to-uql) - coming from Prisma, Drizzle, TypeORM, or MikroORM

Release notes live in [CHANGELOG.md](https://github.com/rogerpadilla/uql/blob/main/CHANGELOG.md).

---

## ⭐ Like what we're doing? Give us a star

It is how other people find the project.

[![Star UQL on GitHub](https://img.shields.io/github/stars/rogerpadilla/uql?style=flat&label=stars&color=3282b5)](https://github.com/rogerpadilla/uql)
