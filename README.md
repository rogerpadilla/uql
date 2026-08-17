<div align="center">

<a href="https://uql-orm.dev">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rogerpadilla/uql/main/assets/logo-dark.svg">
    <img src="https://raw.githubusercontent.com/rogerpadilla/uql/main/assets/logo.svg" alt="UQL" width="72" height="72">
  </picture>
</a>

<h3>The JSON-native TypeScript ORM</h3>

<p>Queries are plain JSON, typed to the leaf. Unified across SQL databases and MongoDB.</p>

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

That is the whole install ([setup](https://uql-orm.dev/getting-started)), and the [imperative API](https://uql-orm.dev/entities/imperative) skips decorators altogether.

```ts
await pool.findMany(User, {
  $select: { id: true, email: true },
  $populate: { posts: { $select: { title: true } } },
  $where: { email: { $endsWith: '@uql-orm.dev' } },
  $limit: 10,
});
```

That query is a serializable value. Build it dynamically, store it, diff it, or send it
from the browser to the server. The same object runs on every supported database.

## Why UQL?

- **Serializable queries (JSON), not method chains.** Plain JSON in, typed rows out. No DSL to learn.
- **Type-safe to the leaf, nothing to generate.** Every key is checked against your entity, down into populated relations and [JSON/JSONB](https://uql-orm.dev/querying/json) dot-paths, so `$like` on a numeric column is a compile error. Entities are plain classes on the standard TC39 decorators: no `.prisma` file, no generated client, no `reflect-metadata`, no `experimentalDecorators`.
- **One API, everywhere it runs.** PostgreSQL, CockroachDB, MySQL, MariaDB, SQLite, Turso, libSQL, Neon, Cloudflare D1, Bun's native SQL, and even MongoDB. The same code on Node 24+, Bun, Deno, [Cloudflare Workers](https://uql-orm.dev/cloudflare-d1), [AWS Lambda and Vercel](https://uql-orm.dev/serverless), and [the browser](https://uql-orm.dev/browser), with no native binaries on the `fetch`-based drivers.
- **Relations without N+1.** [`$populate`](https://uql-orm.dev/querying/relations) loads a to-many with one query for all parents, not one per parent. Nothing is lazy, so nothing fires behind your back in a serializer.
- **Migrations you read before they run.** Edit an entity, run `uql-migrate generate:entities`, review the SQL in the PR like any other file. [`drift:check`](https://uql-orm.dev/migrations) catches a database that no longer matches.
- **Raw SQL when you want it.** [`raw()`](https://uql-orm.dev/querying/raw-sql) fits anywhere in a query, [virtual fields](https://uql-orm.dev/entities/virtual-fields) are sub-queries you can filter on, and a migration can be plain SQL.
- **Light.** Zero runtime dependencies, under 280 kB on the wire, every dialect included. See [what we deleted to get there](https://uql-orm.dev/blog/zero-dependencies).
- **The hard things are built in.** [Semantic and vector search](https://uql-orm.dev/ai-semantic-search), [multi-tenant filters you cannot bypass by accident](https://uql-orm.dev/multi-tenancy), [soft-delete with restore](https://uql-orm.dev/entities/soft-delete), [streaming](https://uql-orm.dev/querying/streaming), and [a REST API from your entities](https://uql-orm.dev/http).
- **The fastest ORM.** On a full PostgreSQL round trip it adds the least over hand-written driver code of any ORM in our open-source [benchmark](https://github.com/rogerpadilla/ts-orm-benchmark), by roughly 3x over the next closest and an order of magnitude over the slowest.

## Get started

**[uql-orm.dev](https://uql-orm.dev)** has the full docs. Good places to start:

- [Quick Start](https://uql-orm.dev/getting-started) - install, define an entity, run a query
- [Querying](https://uql-orm.dev/querying/querier) - operators, relations, aggregates, transactions
- [Entities](https://uql-orm.dev/entities/basic) - decorators, relations, hooks, or the decorator-free [imperative API](https://uql-orm.dev/entities/imperative)
- [Switching to UQL](https://uql-orm.dev/switching-to-uql) - coming from Prisma, Drizzle, TypeORM, or MikroORM

Release notes live in [CHANGELOG.md](https://github.com/rogerpadilla/uql/blob/main/CHANGELOG.md).

## Made with UQL

**[Variability.ai](https://variability.ai)** - AI meeting recorder and video summarizer for Zoom, Meet, and Teams. Instant summaries with action items in 45+ languages.

Built something? [Open a PR](https://github.com/rogerpadilla/uql/blob/main/CONTRIBUTING.md) and add it here.

[![Made with UQL](https://img.shields.io/badge/made%20with-UQL-3282b5?style=flat)](https://uql-orm.dev)
