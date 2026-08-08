<div align="center">

<a href="https://uql-orm.dev">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rogerpadilla/uql/main/assets/logo-dark.svg">
    <img src="https://raw.githubusercontent.com/rogerpadilla/uql/main/assets/logo.svg" alt="UQL" width="90">
  </picture>
</a>

<h3>The smartest TypeScript ORM</h3>

<p>Type-safe to the leaf, serializable queries, no codegen, <a href="https://uql-orm.dev/benchmark">extremely fast</a>, and one API across every SQL database, MongoDB, and every runtime.</p>

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

That is the whole install. Decorators are the standard TC39 ones, so there is no `reflect-metadata`
and no compiler flag to turn on ([setup](https://uql-orm.dev/getting-started)), and the
[imperative API](https://uql-orm.dev/entities/imperative) skips decorators altogether.

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

- **The fastest.** Wins [all 8 categories](https://uql-orm.dev/benchmark) of our open-source [benchmark](https://github.com/rogerpadilla/ts-orm-benchmark), beating even query builders like Knex and Kysely: ~2.4× faster than the runner-up on average, reaching over 4.6M ops/s on simple SELECTs.
- **Light.** Zero runtime dependencies, 305 kB on the wire, every dialect included. See [what we deleted to get there](https://uql-orm.dev/blog/zero-dependencies).
- **Queries are data (JSON), not method chains.** Plain JSON in, typed rows out. There's no DSL to learn and nothing to compile.
- **Type-safe to the leaf.** Every key is autocompleted and checked against your entity, down to the fields of a populated relation. Operators are gated per field type, and [JSON/JSONB](https://uql-orm.dev/querying/json) dot-paths resolve each path's value type, so `$like` on a numeric column, or a typo'd path, is a compile error instead of a runtime surprise.
- **No codegen, no build step.** Entities are TypeScript classes, so your code *is* the schema. There's no `.prisma` file to regenerate and no generated client to keep in sync.
- **One API everywhere.** PostgreSQL, CockroachDB, MySQL, MariaDB, SQLite, Turso, libSQL, Neon, Cloudflare D1, Bun's native SQL, and even MongoDB!
- **Runs on every runtime.** Node 24+, Bun, Deno, [Cloudflare Workers](https://uql-orm.dev/cloudflare-d1), [AWS Lambda and Vercel](https://uql-orm.dev/serverless), and [the browser](https://uql-orm.dev/browser). ESM-only with no native binaries on the `fetch`-based drivers, so an edge bundle needs no special build.
- **The hard things are built in.** [Semantic and vector search](https://uql-orm.dev/ai-semantic-search), [non-bypassable multi-tenant filters](https://uql-orm.dev/multi-tenancy), [entity-first migrations](https://uql-orm.dev/migrations), [soft-delete with restore](https://uql-orm.dev/entities/soft-delete), [streaming](https://uql-orm.dev/querying/streaming), and [a REST API from your entities](https://uql-orm.dev/http).

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

[![Made with UQL](https://img.shields.io/badge/made%20with-UQL-4F46E5?style=flat)](https://uql-orm.dev)
