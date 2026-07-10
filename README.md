<!-- ![code](/assets/code.webp 'code') -->

<picture>
  <source srcset="assets/logo-dark.svg" media="(prefers-color-scheme: dark)">
  <a href="https://uql-orm.dev"><img src="assets/logo.svg" alt="uql" width="80" /></a>
</picture>

[![tests](https://github.com/rogerpadilla/uql/actions/workflows/tests.yml/badge.svg)](https://github.com/rogerpadilla/uql/actions/workflows/tests.yml) [![Coverage Status](https://coveralls.io/repos/github/rogerpadilla/uql/badge.svg?branch=main)](https://coveralls.io/github/rogerpadilla/uql?branch=main) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/rogerpadilla/uql/blob/main/LICENSE) [![npm version](https://img.shields.io/npm/v/uql-orm.svg)](https://www.npmjs.com/package/uql-orm)

**[UQL](https://uql-orm.dev)** is the smartest ORM: serializable queries, no codegen, and one API across PostgreSQL, MySQL, SQLite, MariaDB, and MongoDB. Define entities once, query everywhere.

<!-- DEMO: Record an animated GIF showing IDE autocompletion for $select/$populate/$where and embed here. Example: ![demo](/assets/demo.gif) -->

```ts
await querier.findMany(User, {
  $select: { id: true, email: true },
  $where: { email: { $endsWith: '@uql-orm.dev' } },
  $limit: 10,
});
```

Full docs: **[uql-orm.dev](https://uql-orm.dev)**

---

## Why UQL?

- **Queries are data, not method chains.** A UQL query is a plain JSON object. Build them dynamically, store them, or send them from client to server without a DSL.
- **No codegen, no build step.** Entities are TypeScript classes, so your code *is* the schema. No `.prisma` files or generated clients to keep in sync.
- **One API everywhere.** The same syntax runs on PostgreSQL, MySQL, MariaDB, SQLite, LibSQL, Neon, Cloudflare D1, MongoDB, and Bun's native SQL.
- **Fast by design.** Fastest in [all 8 categories](https://uql-orm.dev/benchmark) of our [open benchmark](https://github.com/rogerpadilla/ts-orm-benchmark): on average ~2.1× faster than the runner-up, reaching 3.5M ops/s on SELECTs and DELETEs.

## Features

| Feature | Docs |
| :--- | :--- |
| Unified API across SQL + MongoDB | [Install](https://uql-orm.dev/getting-started) |
| Type-safe queries with autocomplete | [Querying](https://uql-orm.dev/querying/querier) |
| Entity-first migrations & autoSync | [Migrations](https://uql-orm.dev/migrations) |
| Soft-delete, lifecycle hooks, relations | [Entities](https://uql-orm.dev/entities/basic) |
| Query filters, multi-tenancy & row-level security | [Filters](https://uql-orm.dev/querying/filters) · [Multi-tenancy](https://uql-orm.dev/multi-tenancy) |
| Aggregate queries, grouping, HAVING | [Aggregate](https://uql-orm.dev/querying/aggregate) |
| Semantic search & vector similarity | [Semantic Search](https://uql-orm.dev/ai-semantic-search) |
| Parallel reads & raw SQL on the pool | [Parallel reads](https://uql-orm.dev/querying/querier#parallel-reads-on-the-pool) · [Raw SQL](https://uql-orm.dev/querying/raw-sql) |
| Streaming, transactions | [Streaming](https://uql-orm.dev/querying/streaming) · [Transactions](https://uql-orm.dev/querying/transactions) |
| REST API from your entities (any framework) | [HTTP](https://uql-orm.dev/extensions-http) |
| Typed browser client, NestJS module | [Browser](https://uql-orm.dev/extensions-browser) · [NestJS](https://uql-orm.dev/nestjs) |

## Install

```sh
npm install uql-orm pg   # or mysql2, mariadb, better-sqlite3, mongodb, @libsql/client
```

Supports PostgreSQL, MySQL, MariaDB, SQLite, CockroachDB, LibSQL/Turso, Neon, MongoDB, Cloudflare D1, and Bun SQL.

## Define Entities

[Declare](https://uql-orm.dev/entities/basic) your classes with decorators. UQL uses this metadata for type-safe querying and DDL generation.

```ts
import { v7 as uuidv7 } from 'uuid';
import { Entity, Id, Field, OneToOne, OneToMany, type Relation } from 'uql-orm';

@Entity()
export class User {
  @Id({ type: 'uuid', onInsert: () => uuidv7() })
  id?: string;

  @Field({ index: true, unique: true })
  email?: string;

  @OneToOne({ entity: () => Profile, mappedBy: (p) => p.user, cascade: true })
  profile?: Relation<Profile>;

  @OneToMany({ entity: () => Post, mappedBy: (p) => p.author })
  posts?: Relation<Post>[];
}
```

> **Imperative API:** `defineEntity(User, { fields: { id: { type: 'uuid', isId: true } }, ... })`. No decorators needed. See [Imperative Definition](https://uql-orm.dev/entities/imperative).

## Querying

```ts
await querier.findMany(User, {
  $select: { id: true, name: true },
  $where: { email: { $endsWith: '@uql-orm.dev' } },
  $limit: 10,
});
```

25+ comparison operators (`$eq`, `$in`, `$between`, `$like`, `$elemMatch`), logical operators (`$and`, `$or`, `$not`, `$nor`), and type-safe JSON/JSONB dot-notation queries.

Independent reads run directly on the pool - each call gets its own connection, so `Promise.all` fans out in parallel:

```ts
const [users, total] = await Promise.all([
  pool.findMany(User, { $where: { status: 'active' } }),
  pool.count(User, {}),
]);
```

> [Querying](https://uql-orm.dev/querying/querier) · [Parallel reads](https://uql-orm.dev/querying/querier#parallel-reads-on-the-pool) · [Operators](https://uql-orm.dev/querying/comparison-operators) · [JSON](https://uql-orm.dev/querying/json)

## Transactions

Functional `pool.transaction()` or `@Transactional()` decorator with centralized serialization:

```ts
const userId = await pool.transaction(async (q) => {
  const id = await q.insertOne(User, { email: 'a@b.com' });
  await q.insertOne(Profile, { userId: id, bio: '...' });
  return id;
});
```

## Migrations

Entity-first migrations: modify TypeScript classes, UQL auto-generates DDL by diffing code against the live database:

```bash
npx uql-migrate generate:entities add_user_nickname   # generate from entities
npx uql-migrate up                                      # apply
npx uql-migrate drift:check                             # detect drift
```

Safe `autoSync()` mode adds new tables/columns and blocks destructive changes in development.

> [Migrations](https://uql-orm.dev/migrations)

---

## Made with UQL

### [Variability.ai](https://variability.ai)

AI meeting recorder and video summarizer for Zoom, Meet, Teams, and more. Generates instant summaries with action items in 45+ languages.

[![Made with UQL](https://img.shields.io/badge/made%20with-UQL-6e6e6e?style=flat)](https://uql-orm.dev)
