<div align="center">

<a href="https://uql-orm.dev">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rogerpadilla/uql/main/assets/logo-dark.svg">
    <img src="https://raw.githubusercontent.com/rogerpadilla/uql/main/assets/logo.svg" alt="UQL" width="72" height="72">
  </picture>
</a>

<h3>JSON-native ORM for TypeScript</h3>

<p align="left">UQL hanldes SQL databases and MongoDB with plain & type-safe JSON-syntax.
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
  id!: number;

  @Field({ type: String, unique: true, nullable: false })
  email!: string;

  @OneToMany({ entity: () => Post, mappedBy: (post) => post.author })
  posts?: Post[];
}

@Entity()
export class Post {
  @Id({ type: Number })
  id!: number;

  @Field({ type: String, nullable: false })
  title!: string;

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
npm i -D tsx                                # Node only: the CLI loads uql.config.ts through it
npx uql-migrate generate:entities initial   # diffs the entities against the database into a migration you review
npx uql-migrate up                          # applies it
```

### 3. Query

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

The same queries run from the browser too: [serve them over HTTP](https://uql-orm.dev/http), scoped to the signed-in user by [filters no `$where` can widen](https://uql-orm.dev/multi-tenancy).

## Why UQL?

- **One API, everywhere it runs.** PostgreSQL, PGlite, CockroachDB, MySQL, MariaDB, MSSQL, SQLite, Turso, libSQL, Neon, Cloudflare D1, Bun's native SQL, and even MongoDB. The same code on Node 24+, Bun, Deno, [Cloudflare Workers](https://uql-orm.dev/cloudflare-d1), [AWS Lambda and Vercel](https://uql-orm.dev/serverless), and [the browser](https://uql-orm.dev/browser), with no native binaries on the `fetch`-based drivers.
- **Type-safe to the leaf, nothing to generate.** Every key is checked against your entity, down into populated relations and [JSON/JSONB](https://uql-orm.dev/querying/json) dot-paths, so `$like` on a numeric column is a compile error. No `.prisma` file, no generated client.
- **Relations without N+1.** [`$populate`](https://uql-orm.dev/querying/relations) reads a to-many inside the parent's statement, so a read is one round trip. Nothing is lazy, so nothing fires behind your back in a serializer.
- **Light.** Zero runtime dependencies and every dialect in one package, yet `uql-orm/postgres` is about 27 kB gzipped. See [what we deleted to get there](https://uql-orm.dev/blog/zero-dependencies).
- **The hard things are built in.** [Semantic and vector search](https://uql-orm.dev/ai-semantic-search), [multi-tenant filters you cannot bypass by accident](https://uql-orm.dev/multi-tenancy), [soft-delete with restore](https://uql-orm.dev/entities/soft-delete), [streaming](https://uql-orm.dev/querying/streaming), and [drift checks](https://uql-orm.dev/migrations) that catch a database that no longer matches.
- **SQL when you need it.** [`raw()`](https://uql-orm.dev/querying/raw-sql) fits anywhere a value or a field goes, [computed fields](https://uql-orm.dev/entities/computed-fields) are SQL you can filter and sort on, and a migration can be plain SQL.
- **The fastest ORM.** On a full PostgreSQL round trip it adds the least over hand-written driver code of any ORM in our open-source [benchmark](https://github.com/rogerpadilla/ts-orm-benchmark), on Bun, Node and Deno alike. The same benchmark [scores the types](https://github.com/rogerpadilla/ts-orm-benchmark#type-safety) by compiling ordinary mistakes in each ORM's API: UQL is the only one that catches them all.

## Get started

Follow the [Quick Start](https://uql-orm.dev/getting-started), or [switch from](https://uql-orm.dev/switching-to-uql) Prisma, Drizzle, TypeORM or MikroORM. The [examples](examples) are runnable apps on Node, Bun, Next.js and Cloudflare D1, each checked in CI.

Using a coding agent? The package ships a [skill](skills/uql-orm/SKILL.md) for it, and every docs page is Markdown: [set it up](https://uql-orm.dev/ai-agents).

Release notes live in [CHANGELOG.md](https://github.com/rogerpadilla/uql/blob/main/CHANGELOG.md).

---

## ⭐ Wanna see UQL grow? Give it a star please!

Your star helps other developers find UQL.

[![Star UQL on GitHub](https://img.shields.io/badge/Star_on_GitHub-3282b5?style=flat&logo=github)](https://github.com/rogerpadilla/uql)
