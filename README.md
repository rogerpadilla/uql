<!-- ![code](/assets/code.webp 'code') -->

<picture>
  <source srcset="assets/logo-dark.svg" media="(prefers-color-scheme: dark)">
  <a href="https://uql-orm.dev"><img src="assets/logo.svg" alt="uql" width="80" /></a>
</picture>

[![tests](https://github.com/rogerpadilla/uql/actions/workflows/tests.yml/badge.svg)](https://github.com/rogerpadilla/uql/actions/workflows/tests.yml) [![Coverage Status](https://coveralls.io/repos/github/rogerpadilla/uql/badge.svg?branch=main)](https://coveralls.io/github/rogerpadilla/uql?branch=main) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/rogerpadilla/uql/blob/main/LICENSE) [![npm version](https://img.shields.io/npm/v/uql-orm.svg)](https://www.npmjs.com/package/uql-orm)

**[UQL](https://uql-orm.dev)** is a type-safe TypeScript ORM with a single unified API across PostgreSQL, MySQL, SQLite, MariaDB, and MongoDB. Define entities once, query everywhere.

<!-- DEMO: Record an animated GIF showing IDE autocompletion for $select/$populate/$where and embed here. Example: ![demo](/assets/demo.gif) -->

```ts
import { PgQuerierPool } from 'uql-orm/postgres';

const pool = new PgQuerierPool({ host: 'localhost', database: 'app' });

const users = await pool.withQuerier((q) =>
  q.findMany(User, {
    $select: { id: true, name: true },
    $populate: { profile: { $select: { bio: true } } },
    $where: { name: { $istartsWith: 'A' } },
    $limit: 10,
  }),
);
```

Full docs: **[uql-orm.dev](https://uql-orm.dev)**

---

## Features

| Feature | Docs |
| :--- | :--- |
| Type-safe queries with autocomplete | [Querying](https://uql-orm.dev/querying/querier) |
| Unified API across SQL + MongoDB | [Install](https://uql-orm.dev/getting-started) |
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

### Core Decorators

| Decorator | Purpose |
| :--- | :--- |
| `@Entity()` | Marks a class as a database table/collection. |
| `@Id()` | Primary key with `onInsert` generators. |
| `@Field()` | Standard column. `{ references: ... }` for Foreign Keys. |
| `@Index()` | Composite or custom index. |
| `@OneToOne` / `@OneToMany` / `@ManyToOne` / `@ManyToMany` | Relationship definitions. |
| `@BeforeInsert` / `@AfterLoad` | Lifecycle hooks. |

### Logical vs. Physical Types

`type` specifies the logical type; `columnType` specifies the exact SQL type (highest priority). Both are optional. UQL infers from TypeScript types.

```ts
@Field() name?: string;                // → TEXT (Postgres), VARCHAR(255) (MySQL)
@Field({ type: 'uuid' })               // → UUID, CHAR(36), TEXT (portable)
@Field({ type: 'json' }) metadata?: Json<{ theme?: string }>;
@Field({ columnType: 'smallint' })     // dialect-specific override
```

### Entity Example

Use `Relation<T>` for relationship properties to avoid circular dependency errors:

```ts
import { Entity, Id, Field, OneToOne, OneToMany, ManyToOne, type Relation } from 'uql-orm';

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

@Entity()
export class Profile {
  @Id({ type: 'uuid', onInsert: () => uuidv7() })
  id?: string;

  @Field({ references: () => User })
  userId?: string;

  @OneToOne({ entity: () => User })
  user?: User;
}
```

 > **Imperative API:** `defineEntity(User, { fields: { id: { type: 'uuid', isId: true } }, ... })`. No decorators needed. See [Imperative Definition](https://uql-orm.dev/entities/imperative).

---

## Set up a Pool

```ts
import { PgQuerierPool, SnakeCaseNamingStrategy } from 'uql-orm/postgres';

export const pool = new PgQuerierPool(
  { host: 'localhost', database: 'app', max: 10 },
  { logger: ['error', 'warn', 'migration'], namingStrategy: new SnakeCaseNamingStrategy() },
);
```

Reuse the same `uql.config.ts` for both app queries and migrations. See [Unified Configuration](https://uql-orm.dev/getting-started).

---

## Querying

`pool.withQuerier()` acquires a querier, runs the callback, and guarantees release:

```ts
const users = await pool.withQuerier((q) =>
  q.findMany(User, {
    $select: { id: true, name: true },
    $populate: { profile: { $select: { bio: true } } },
    $where: { status: 'active', name: { $istartsWith: 'A' } },
    $sort: { createdAt: 'desc' },
    $limit: 10,
  }),
);
```

### Projection & Relation Loading

| Key | Purpose |
| :--- | :--- |
| `$select` | Scalar field whitelist (projection) |
| `$exclude` | Scalar field subtraction from default eager set |
| `$populate` | Relation loading (supports nested query options) |

`$populate` supports `$required: true` for INNER JOIN semantics:

```ts
const rows = await pool.withQuerier((q) =>
  q.findMany(User, {
    $exclude: { password: true },
    $populate: { profile: { $select: { picture: true } } },
  }),
);
```

### Operators

**Comparison:** `$eq`, `$ne`, `$lt`, `$lte`, `$gt`, `$gte`, `$between: [a, b]`, `$in`, `$nin`, `$all`, `$isNull`, `$isNotNull`, `$size`, `$elemMatch`

**String:** `$startsWith`, `$istartsWith`, `$endsWith`, `$iendsWith`, `$includes`, `$iincludes`, `$like`, `$ilike`, `$regex`

**Logical:** `$and`, `$or`, `$not`, `$nor`:

```ts
$q: { $or: [{ name: { $istartsWith: 'A' } }, { status: 'pending' }] }
$q: { $not: [{ status: 'banned' }, { role: 'admin' }] }
```

> [Comparison Operators](https://uql-orm.dev/querying/comparison-operators) · [Logical Operators](https://uql-orm.dev/querying/logical-operators)

### Generated SQL (PostgreSQL)

```sql
SELECT "User"."name", "profile"."id" AS "profile_id", "profile"."bio" AS "profile_bio"
FROM "User" INNER JOIN "Profile" AS "profile" ON "profile"."userId" = "User"."id"
WHERE "User"."status" = $1 AND "User"."name" ILIKE $2
ORDER BY "User"."createdAt" DESC LIMIT 10
```

---

## Relations & JSON

**Relation filtering:** Filter parents by ManyToMany / OneToMany relations via automatic EXISTS subqueries:

```ts
const posts = await pool.withQuerier((q) =>
  q.findMany(Post, { $where: { tags: { name: 'typescript' } } }),
);
```

**JSON / JSONB:** Type-safe dot-notation queries:

```ts
const companies = await pool.withQuerier((q) =>
  q.findMany(Company, { $where: { 'settings.isArchived': { $ne: true } } }),
);
```

Atomic JSON updates: `$merge`, `$unset`, `$push`:

```ts
await pool.withQuerier((q) =>
  q.updateOneById(Company, id, {
    settings: { $merge: { theme: 'dark' }, $push: { tags: 'orm' }, $unset: ['deprecated'] },
  }),
);
```

> [JSON / JSONB](https://uql-orm.dev/querying/json)

---

## Aggregate Queries

```ts
const results = await pool.withQuerier((q) =>
  q.aggregate(Order, {
    $group: { status: true, total: { $sum: 'amount' }, count: { $count: '*' } },
    $having: { count: { $gt: 5 } },
    $sort: { total: 'desc' },
    $limit: 10,
  }),
);
```

**Distinct:** add `$distinct: true` to any find query.

> [Aggregate Queries](https://uql-orm.dev/querying/aggregate)

---

## Upsert & Delete

```ts
await pool.withQuerier((q) => q.upsertOne(User, ['email'], { email: 'a@b.com', name: 'Alice' }));
await pool.withQuerier((q) => q.deleteOneById(User, 1));
await pool.withQuerier((q) => q.deleteMany(User, { status: 'inactive' }));
```

---

## Transactions

Centralized serialization engine guarantees race-condition free transactions.

**Functional:** `pool.transaction()` acquires a querier, runs the callback, commits or rolls back:

```ts
const userId = await pool.transaction(async (q) => {
  const user = await q.findOne(User, { $where: { email: 'a@b.com' } });
  await q.insertOne(Profile, { userId: user.id, bio: '...' });
  return user.id;
});
```

**Decorators:** `@Transactional()` + `@InjectQuerier()` for DI frameworks like NestJS:

```ts
import { Transactional, InjectQuerier, type Querier } from 'uql-orm';

export class UserService {
  @Transactional()
  async register({ picture, ...user }: UserProfile, @InjectQuerier() querier?: Querier) {
    const id = await querier!.insertOne(User, user);
    await querier!.insertOne(Profile, { userId: id, picture });
    return id;
  }
}
```

> [Transactions](https://uql-orm.dev/querying/transactions)

---

## Migrations

Entity-First approach: modify TypeScript classes, UQL auto-generates migrations by diffing code against the live database.

```bash
npx uql-migrate generate:entities add_user_nickname   # generate from entities
npx uql-migrate up                                      # apply
npx uql-migrate drift:check                             # detect drift
```

| Command | Description |
| :--- | :--- |
| `generate:entities <name>` | Auto-generates migration by diffing entities against the DB. |
| `generate <name>` | Creates an empty file for manual SQL migrations. |
| `generate:from-db` | Scaffolds entities from an existing database. |
| `drift:check` | Compares entities against live DB schema. |
| `up` / `down` / `status` | Apply, rollback, inspect. |

### AutoSync (Development)

Safe by default. Adds new tables/columns, blocks destructive changes:

```ts
import { Migrator } from 'uql-orm/migrate';
import config from './uql.config.js';
const migrator = new Migrator(config.pool, { entities: config.entities });
await migrator.autoSync({ logging: true });
```

---

## Advanced Topics

| Topic | Link |
| :--- | :--- |
| Comparison operators (25+) | [docs](https://uql-orm.dev/querying/comparison-operators) |
| Logical operators (`$and`/`$or`/`$not`/`$nor`) | [docs](https://uql-orm.dev/querying/logical-operators) |
| Raw SQL (`all<T>()`, `run()`, `raw()`) | [docs](https://uql-orm.dev/querying/raw-sql) |
| Soft-delete | [docs](https://uql-orm.dev/entities/soft-delete) |
| Lifecycle hooks | [docs](https://uql-orm.dev/entities/lifecycle-hooks) |
| Naming strategies | [docs](https://uql-orm.dev/naming-strategy) |
| Semantic search (vector similarity) | [docs](https://uql-orm.dev/ai-semantic-search) |
| Cursor streaming | [docs](https://uql-orm.dev/querying/streaming) |
| HttpQuerier (browser) | [docs](https://uql-orm.dev/comparison) |

---

Built with ❤️ and supported by **[Variability.ai](https://variability.ai)**.
