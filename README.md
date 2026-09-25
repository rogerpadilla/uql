<div align="center">

<a href="https://uql-orm.dev">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rogerpadilla/uql/main/assets/logo-dark.svg">
    <img src="https://raw.githubusercontent.com/rogerpadilla/uql/main/assets/logo.svg" alt="UQL" width="72" height="72">
  </picture>
</a>

<h3>JSON-native ORM for TypeScript</h3>

<p align="left">UQL queries SQL databases and MongoDB with plain, type-safe JSON-syntax.
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

## How it fits together

### 1. The entities are the schema

```ts
// entities.ts
import { Entity, Field, Id, ManyToOne, OneToMany } from 'uql-orm';

@Entity()
export class User {
  @Id({ type: Number })
  id?: number;

  @Field({ type: String, unique: true })
  email?: string | null;

  @OneToMany({ entity: () => Post, mappedBy: (post) => post.author })
  posts?: Post[];
}

@Entity()
export class Post {
  @Id({ type: Number })
  id?: number;

  @Field({ type: String })
  title?: string | null;

  @Field({ type: Number })
  likes?: number | null;

  @Field({ references: () => User })
  authorId?: number | null;

  @ManyToOne({ entity: () => User, references: (post) => post.authorId })
  author?: User;
}
```

### 2. A pool, and the migrations it drives

```ts
// uql.config.ts
import type { Config } from 'uql-orm';
import { PgQuerierPool } from 'uql-orm/postgres';
import { Post, User } from './entities.js';

export const pool = new PgQuerierPool({ connectionString: process.env.DATABASE_URL });

export default { pool, entities: [User, Post] } satisfies Config;
```

```sh
npx uql-migrate generate:entities initial   # diffs the entities against the database into a migration you review
npx uql-migrate up                          # applies it
```

### 3. Query on the server

```ts
import { Post } from './entities.js';
import { pool } from './uql.config.js';

const posts = await pool.findMany(Post, {
  $select: { title: true },
  $populate: { author: { $select: { email: true } } },
  $where: { likes: { $gte: 10 } },
  $sort: { likes: 'desc' },
  $limit: 10,
});
// SELECT "Post"."title", "author"."id" "author.id", "author"."email" "author.email"
// FROM "Post" LEFT JOIN "User" "author" ON "author"."id" = "Post"."authorId"
// WHERE "Post"."likes" >= $1 ORDER BY "Post"."likes" DESC LIMIT 10
```

The result is typed to what the query selected: `posts[0].author?.email` compiles, `posts[0].likes` does not.

### 4. Or serve it over HTTP, scoped to the signed-in user

```ts
// server.ts: Bun, Deno, Cloudflare Workers, or any framework that takes a fetch handler
import { defineFilter } from 'uql-orm';
import { createFetchHandler } from 'uql-orm/http';
import { authenticate } from './auth.js';
import { Post } from './entities.js';
import { pool } from './uql.config.js';

declare module 'uql-orm' {
  interface UqlContext {
    userId?: number;
  }
}

// Scopes every read and write on Post: no `$where` widens it, a new post gets `authorId`, and with no user it throws.
defineFilter(Post, 'ownPosts', {
  where: (ctx) => (ctx?.userId != null ? { authorId: ctx.userId } : undefined),
  security: true,
});

export default {
  fetch: createFetchHandler({
    pool,
    include: [Post],
    // From your verified session, never from client input.
    getContext: async (request) => ({ userId: (await authenticate(request)).userId }),
  }),
};
```

The client sends a query as JSON and gets the same typed result, never touching the database:

```ts
// client.ts
import { HttpQuerier } from 'uql-orm/browser';
import { Post } from './entities.js';

const api = new HttpQuerier('https://api.example.com');

const { data: posts } = await api.findMany(Post, {
  $select: { title: true },
  $where: { likes: { $gte: 10 } },
  $sort: { likes: 'desc' },
  $limit: 10,
});
```

Only the entities in `include` are served: a `$populate: { author: true }` here is a `400`, as `User` is not. More in [HTTP](https://uql-orm.dev/http) and [multi-tenancy](https://uql-orm.dev/multi-tenancy).

### When CRUD is not enough

- [`raw()`](https://uql-orm.dev/querying/raw-sql) fits anywhere a value or a field goes, and a migration can be plain SQL.
- [Computed fields](https://uql-orm.dev/entities/computed-fields) are SQL expressions that you can filter and sort on. [Triggers](https://uql-orm.dev/entities/triggers) run inside the database.
- [Transactions](https://uql-orm.dev/querying/transactions) hold one connection across many operations, and [lifecycle hooks](https://uql-orm.dev/entities/lifecycle-hooks) run your code around each write.
- Anything the CRUD routes do not cover goes in a route you write, beside the handler and under the same prefix.

## Why UQL?

- **One API, everywhere it runs.** PostgreSQL, PGlite, CockroachDB, MySQL, MariaDB, MSSQL, SQLite, Turso, libSQL, Neon, Cloudflare D1, Bun's native SQL, and even MongoDB. The same code on Node 24+, Bun, Deno, [Cloudflare Workers](https://uql-orm.dev/cloudflare-d1), [AWS Lambda and Vercel](https://uql-orm.dev/serverless), and [the browser](https://uql-orm.dev/browser), with no native binaries on the `fetch`-based drivers.
- **Type-safe to the leaf, nothing to generate.** Every key is checked against your entity, down into populated relations and [JSON/JSONB](https://uql-orm.dev/querying/json) dot-paths, so `$like` on a numeric column is a compile error. No `.prisma` file, no generated client.
- **Relations without N+1.** [`$populate`](https://uql-orm.dev/querying/relations) reads a to-many inside the parent's statement, so a read is one round trip. Nothing is lazy, so nothing fires behind your back in a serializer.
- **Light.** Zero runtime dependencies and every dialect in one package, yet `uql-orm/postgres` is about 27 kB gzipped. See [what we deleted to get there](https://uql-orm.dev/blog/zero-dependencies).
- **The hard things are built in.** [Semantic and vector search](https://uql-orm.dev/ai-semantic-search), [multi-tenant filters you cannot bypass by accident](https://uql-orm.dev/multi-tenancy), [soft-delete with restore](https://uql-orm.dev/entities/soft-delete), [streaming](https://uql-orm.dev/querying/streaming), [drift checks](https://uql-orm.dev/migrations) that catch a database that no longer matches, and [Better Auth](https://uql-orm.dev/better-auth) on every engine.
- **The fastest ORM.** On a full PostgreSQL round trip it adds the least over hand-written driver code of any ORM in our open-source [benchmark](https://github.com/rogerpadilla/ts-orm-benchmark), on Bun, Node and Deno alike. The same benchmark [scores the types](https://github.com/rogerpadilla/ts-orm-benchmark#type-safety) by compiling ordinary mistakes in each ORM's API: UQL is the only one that catches them all.

## Get started

**[uql-orm.dev](https://uql-orm.dev)** has the full docs. Good places to start:

- [Quick Start](https://uql-orm.dev/getting-started) - install, define an entity, run a query
- [Querying](https://uql-orm.dev/querying/querier) - operators, relations, aggregates, transactions
- [Entities](https://uql-orm.dev/entities/basic) - decorators, relations, hooks, or the decorator-free [imperative API](https://uql-orm.dev/entities/imperative)
- [Switching to UQL](https://uql-orm.dev/switching-to-uql) - coming from Prisma, Drizzle, TypeORM, or MikroORM

Using a coding agent? The package ships a [skill](skills/uql-orm/SKILL.md) for it, and every docs page is Markdown: [set it up](https://uql-orm.dev/ai-agents).

Release notes live in [CHANGELOG.md](https://github.com/rogerpadilla/uql/blob/main/CHANGELOG.md).

---

## ⭐ Wanna help UQL grow? Give us a star please!

Your star helps other developers find UQL.

[![Star UQL on GitHub](https://img.shields.io/badge/Star_on_GitHub-3282b5?style=flat&logo=github)](https://github.com/rogerpadilla/uql)
