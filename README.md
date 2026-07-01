<!-- ![code](/assets/code.webp 'code') -->

<picture>
  <source srcset="assets/logo-dark.svg" media="(prefers-color-scheme: dark)">
  <a href="https://uql-orm.dev"><img src="assets/logo.svg" alt="uql" width="80" /></a>
</picture>

[![tests](https://github.com/rogerpadilla/uql/actions/workflows/tests.yml/badge.svg)](https://github.com/rogerpadilla/uql/actions/workflows/tests.yml) [![Coverage Status](https://coveralls.io/repos/github/rogerpadilla/uql/badge.svg?branch=main)](https://coveralls.io/github/rogerpadilla/uql?branch=main) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/rogerpadilla/uql/blob/main/LICENSE) [![npm version](https://img.shields.io/npm/v/uql-orm.svg)](https://www.npmjs.com/package/uql-orm)

**[UQL](https://uql-orm.dev)** is a type-safe TypeScript ORM with a single unified API across PostgreSQL, MySQL, SQLite, MariaDB, and MongoDB. Define entities once, query everywhere.

<!-- DEMO: Record an animated GIF showing IDE autocompletion for $select/$populate/$where and embed here. Example: ![demo](/assets/demo.gif) -->

```ts
await querier.findMany(User, {
  $select: { id: true, name: true },
  $where: { email: { $endsWith: '@uql-orm.dev' } },
  $limit: 10,
});
```

Full docs: **[uql-orm.dev](https://uql-orm.dev)**

---

## Features

| Feature | Docs |
| :--- | :--- |
| Unified API across SQL + MongoDB | [Install](https://uql-orm.dev/getting-started) |
| Type-safe queries with autocomplete | [Querying](https://uql-orm.dev/querying/querier) |
| Entity-first migrations & autoSync | [Migrations](https://uql-orm.dev/migrations) |
| Soft-delete, lifecycle hooks, relations | [Entities](https://uql-orm.dev/entities/basic) |
| Aggregate queries, grouping, HAVING | [Aggregate](https://uql-orm.dev/querying/aggregate) |
| Semantic search & vector similarity | [Semantic Search](https://uql-orm.dev/ai-semantic-search) |
| Streaming, transactions, raw SQL | [Querying](https://uql-orm.dev/querying/querier) |
| NestJS integration & HttpQuerier | [Fullstack](https://uql-orm.dev/comparison) |

## Install

```sh
npm install uql-orm pg   # or mysql2, mariadb, better-sqlite3, mongodb, @libsql/client
```

Supports PostgreSQL, MySQL, MariaDB, SQLite, CockroachDB, MongoDB, Cloudflare D1, and Bun SQL.

## Define Entities

[Declare](https://uql-orm.dev/entities/basic) your classes with decorators. UQL uses this metadata for type-safe querying and DDL generation.

```ts
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

> [Querying](https://uql-orm.dev/querying/querier) · [Operators](https://uql-orm.dev/querying/comparison-operators) · [JSON](https://uql-orm.dev/querying/json)

## Transactions

Functional `pool.transaction()` or `@Transactional()` decorator with centralized serialization:

```ts
const userId = await pool.transaction(async (q) => {
  const user = await q.findOne(User, { $where: { email: 'a@b.com' } });
  await q.insertOne(Profile, { userId: user.id, bio: '...' });
  return user.id;
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
