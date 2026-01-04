<!-- ![code](/assets/code.webp 'code') -->

[![uql maku](assets/logo.svg)](https://uql.app)

[![tests](https://github.com/rogerpadilla/uql/actions/workflows/tests.yml/badge.svg)](https://github.com/rogerpadilla/uql) [![Coverage Status](https://coveralls.io/repos/github/rogerpadilla/uql/badge.svg?branch=main)](https://coveralls.io/github/rogerpadilla/uql?branch=main) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/rogerpadilla/uql/blob/main/LICENSE) [![npm version](https://img.shields.io/npm/v/@uql/core.svg)](https://www.npmjs.com/package/@uql/core)

**[UQL](https://uql.app)** is the [smartest ORM](https://medium.com/@rogerpadillac/in-search-of-the-perfect-orm-e01fcc9bce3d) for TypeScript. It is engineered to be **fast**, **safe**, and **universally compatible**.

- **Runs Everywhere**: Node.js, Bun, Deno, Cloudflare Workers, Electron, React Native, and the Browser.
- **Unified API**: A consistent query interface for PostgreSQL (incl. CockroachDB, YugabyteDB), MySQL (incl. TiDB, Aurora), MariaDB, SQLite, LibSQL, Neon, Cloudflare D1, and MongoDB.

&nbsp;

```ts
const users = await querier.findMany(User, {
  $select: { email: true, profile: { $select: { picture: true } } },
  $where: { email: { $endsWith: '@domain.com' } },
  $sort: { createdAt: 'desc' },
  $limit: 100,
});
```

&nbsp;

## Why UQL?

| Feature              | **UQL**                                                             | Traditional ORMs                                        |
| :------------------- | :------------------------------------------------------------------------ | :------------------------------------------------------ |
| **API**        | **Unified & Intuitive**: Same syntax for SQL & NoSQL.               | Fragmented: SQL and Mongo feel like different worlds.   |
| **Safety**     | **Deep Type-Safety**: Validates relations & operators at any depth. | Surface-level: Often loses types in complex joins.      |
| **Syntax**     | **Serializable JSON**: Pure data, perfect for APIs/Websockets.      | Method-Chaining: Hard to transport over the wire.       |
| **Efficiency** | **Sticky Connections**: Minimal overhead, human-readable SQL.       | Heavy: Often generates "SQL Soup" that's hard to debug. |

&nbsp;

## Features

| Feature                                                                  | Description                                                                                                                     |
| :----------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| **[Context-Aware Queries](https://uql.app/querying/relations)**       | Deep type-safety for operators and [relations](https://uql.app/querying/relations) at any depth.                                   |
| **Serializable JSON**                                              | 100% valid JSON queries for easy transport over HTTP/Websockets.                                                                |
| **Unified Dialects**                                               | Write once, run anywhere: PostgreSQL, MySQL, SQLite, MongoDB, and more.                                                         |
| **Naming Strategies**                                              | Pluggable system to translate between TypeScript `camelCase` and database `snake_case`.                                     |
| **Smart SQL Engine**                                               | Optimized sub-queries, placeholders ($1, $2), and minimal SQL generation via `QueryContext`.                                  |
| **Thread-Safe by Design**                                          | Centralized task queue and `@Serialized()` decorator prevent race conditions.                                                 |
| **Declarative Transactions**                                       | Standard `@Transactional()` and `@InjectQuerier()` decorators for NestJS/DI.                                                |
| **[Modern &amp; Versatile](https://uql.app/entities/virtual-fields)** | **Pure ESM**, high-res timing, [Soft-delete](https://uql.app/entities/soft-delete), and **Vector/JSONB/JSON** support. |
| **Structured Logging**                                             | Professional-grade monitoring with slow-query detection and colored output.                                                     |

&nbsp;

## 1. Install

Install the core package and the driver for your database:

```sh
# Core
npm install @uql/core       # or bun add / pnpm add
```

### Supported Drivers (choose according to your database)

| Database | Command |
| :--- | :--- |
| **PostgreSQL** (incl. Neon, Cockroach, Yugabyte) | `npm install pg` |
| **MySQL** (incl. TiDB, Aurora) | `npm install mysql2` |
| **MariaDB** | `npm install mariadb` |
| **SQLite** | `npm install better-sqlite3` |
| **LibSQL** (incl. Turso) | `npm install @libsql/client` |
| **MongoDB** | `npm install mongodb` |
| **Cloudflare D1** | _Native (no driver needed)_ |

### TypeScript Configuration

Ensure your `tsconfig.json` is configured to support decorators and metadata:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "module": "NodeNext",
    "target": "ESNext"
  }
}
```

&nbsp;**Note:** `ES2020+` will work for `target` as well.

## 2. Define the Entities

Annotate your classes with decorators. UQL's engine uses this metadata for both type-safe querying and precise DDL generation.

### Core Decorators

| Decorator       | Purpose                                                                        |
| :-------------- | :----------------------------------------------------------------------------- |
| `@Entity()`   | Marks a class as a database table/collection.                                  |
| `@Id()`       | Defines the Primary Key with support for `onInsert` generators (UUIDs, etc). |
| `@Field()`    | Standard column. Use `{ reference: ... }` for Foreign Keys.                    |
| `@OneToOne`.. | (`@OneToOne`, `@OneToMany`, etc) Defines type-safe relationships.              |

```ts
import { v7 as uuidv7 } from 'uuid';
import { Entity, Id, Field, OneToOne, OneToMany, ManyToOne, ManyToMany, type Relation } from '@uql/core';

@Entity()
export class User {
  @Id({ onInsert: () => uuidv7() })
  id?: string;

  @Field({
    index: true,
  })
  name?: string;

  @Field({
    unique: true,
    comment: 'User login email',
  })
  email?: string;

  @OneToOne({
    entity: () => Profile,
    mappedBy: 'user',
    cascade: true,
  })
  profile?: Relation<Profile>; // Relation<T> handles circular dependencies

  @OneToMany({
    entity: () => Post,
    mappedBy: 'author',
  })
  posts?: Relation<Post>[];
}

@Entity()
export class Profile {
  @Id({ onInsert: () => uuidv7() })
  id?: string;

  @Field()
  bio?: string;

  @Field({ reference: () => User })
  userId?: string;

  @OneToOne({ entity: () => User })
  user?: User;
}

@Entity()
export class Post {
  @Id()
  id?: number;

  @Field()
  title?: string;

  @Field({ reference: () => User })
  authorId?: string;

  @ManyToOne({ entity: () => User })
  author?: User;

  @ManyToMany({
    entity: () => Tag,
    through: () => PostTag,
  })
  tags?: Tag[];
}

@Entity()
export class Tag {
  @Id({ onInsert: () => uuidv7() })
  id?: string;

  @Field()
  name?: string;
}

@Entity()
export class PostTag {
  @Id({ onInsert: () => uuidv7() })
  id?: string;

  @Field({ reference: () => Post })
  postId?: number;

  @Field({ reference: () => Tag })
  tagId?: string;
}
```

> **Pro Tip**: Use the `Relation<T>` utility type for relationship properties. It prevents TypeScript circular dependency errors while maintaining full type-safety.

&nbsp;

## 3. Set up a pool

A pool manages connections (queriers). Initialize it once at application bootstrap (e.g., in `server.ts`).

```ts
import { PgQuerierPool } from '@uql/core/postgres'; // or mysql2, sqlite, etc.
import { SnakeCaseNamingStrategy, type Config } from '@uql/core';
import { User, Profile, Post } from './entities';

export const pool = new PgQuerierPool(
  { host: 'localhost', database: 'uql_app', max: 10 },
  {
    logger: true,
    slowQueryThreshold: 200,
    namingStrategy: new SnakeCaseNamingStrategy()
  }
);

export default {
  pool,
  // entities: [User, Profile, Post], // Optional: inferred from @Entity() decorators
  migrationsPath: './migrations',
} satisfies Config;
```

> **Pro Tip**: Reusing the same connection pool for both your application and migrations is recommended. It reduces connection overhead and ensures consistent query settings (like naming strategies).

&nbsp;

&nbsp;

## 4. Manipulate the Data

UQL provides a straightforward API to interact with your data. **Always ensure queriers are released back to the pool.**

```ts
const querier = await pool.getQuerier();
try {
  const users = await querier.findMany(User, {
    $select: {
      name: true,
      profile: { $select: ['bio'], $required: true } // INNER JOIN
    },
    $where: {
      status: 'active',
      name: { $istartsWith: 'a' } // Case-insensitive search
    },
    $limit: 10,
    $skip: 0
  });
} finally {
  await querier.release(); // Essential for pool health
}
```

**Generated SQL (PostgreSQL):**

```sql
SELECT "User"."name", "profile"."id" AS "profile_id", "profile"."bio" AS "profile_bio"
FROM "User"
INNER JOIN "Profile" AS "profile" ON "profile"."userId" = "User"."id"
WHERE "User"."status" = 'active' AND "User"."name" ILIKE 'a%'
LIMIT 10 OFFSET 0
```

&nbsp;

### Advanced: Virtual Fields & Raw SQL

Define complex logic directly in your entities using `raw` functions. These are resolved during SQL generation for peak efficiency.

```ts
@Entity()
export class Item {
  @Field({
    virtual: raw(({ ctx, dialect, escapedPrefix }) => {
      ctx.append('(');
      dialect.count(ctx, ItemTag, {
        $where: { itemId: raw(({ ctx }) => ctx.append(`${escapedPrefix}.id`)) }
      }, { autoPrefix: true });
      ctx.append(')');
    })
  })
  tagsCount?: number;
}
```

&nbsp;

### Thread-Safe Transactions

UQL is one of the few ORMs with a **centralized serialization engine**. Transactions are guaranteed to be race-condition free.

#### Option A: Manual (Functional)

```ts
const result = await pool.transaction(async (querier) => {
  const user = await querier.findOne(User, { $where: { email: '...' } });
  await querier.insertOne(Profile, { userId: user.id, bio: '...' });
});
```

#### Option B: Declarative (Decorators)

Perfect for **NestJS** and other Dependency Injection frameworks. Use `@Transactional()` to wrap a method and `@InjectQuerier()` to access the managed connection.

```ts
import { Transactional, InjectQuerier, type Querier } from '@uql/core';

export class UserService {
  @Transactional()
  async register({picture, ...user}: UserProfile, @InjectQuerier() querier?: Querier) {
    const userId = await querier.insertOne(User, user);
    await querier.insertOne(Profile, { userId, picture });
  }
}
```

&nbsp;


&nbsp;

## 5. Migrations & Synchronization

### 1. Unified Configuration

Ideally, use the same `uql.config.ts` for your application bootstrap and the CLI:

```ts
// uql.config.ts
import type { Config } from '@uql/core';

export default {
  pool: new PgQuerierPool({ /* ... */ }),
  // entities: [User, Post], // Optional: inferred from @Entity() decorators
  migrationsPath: './migrations',
} satisfies Config;
```

**Why?** Using a single config for both your app and the CLI is recommended for consistency. It prevents bugs where your runtime uses one naming strategy (e.g. `camelCase`) but your migrations use another (e.g. `snake_case`), or where the CLI isn't aware of all your entities. It enforces a Single Source of Truth for your database connection and schema.

### 2. Manage via CLI

```bash
# Generate from entities
npx uql-migrate generate:entities initial_schema
# Run pending
npx uql-migrate up
# Rollback last migration
npx uql-migrate down
# Using a custom config path
npx uql-migrate up --config ./configs/uql.config.ts
```

### 3. AutoSync (Development)

Keep your schema in sync without manual migrations. It safely adds missing tables/columns.

```ts
const migrator = new Migrator(pool);
await migrator.autoSync({ logging: true });
```

&nbsp;

## 6. Logging & Monitoring

UQL features a professional-grade, structured logging system designed for high visibility and sub-millisecond performance monitoring.

### Log Levels

| Level                 | Description                                                                             |
| :-------------------- | :-------------------------------------------------------------------------------------- |
| `query`             | **Standard Queries**: Beautifully formatted SQL/Command logs with execution time. |
| `slowQuery`         | **Bottleneck Alerts**: Dedicated logging for queries exceeding your threshold.    |
| `error` / `warn`  | **System Health**: Detailed error traces and potential issue warnings.            |
| `migration`         | **Audit Trail**: Step-by-step history of schema changes.                          |
| `schema` / `info` | **Lifecycle**: Informative logs about ORM initialization and sync events.         |

### Visual Feedback

The `DefaultLogger` provides high-contrast, colored output out of the box:

```text
query: SELECT * FROM "user" WHERE "id" = $1 -- [123] [2ms]
slow query: UPDATE "post" SET "title" = $1 -- ["New Title"] [1250ms]
error: Failed to connect to database: Connection timeout
```

> **Pro Tip**: Even if you disable general query logging in production (`logger: ['error', 'warn', 'slowQuery']`), UQL stays silent *until* a query exceeds your threshold.

&nbsp;

Learn more about UQL at [uql.app](https://uql.app) for details on:

- [Complex Logical Operators](https://uql.app/querying/logical-operators)
- [Relationship Mapping (1-1, 1-M, M-M)](https://uql.app/querying/relations)
- [Soft Deletes &amp; Auditing](https://uql.app/entities/soft-delete)
- [Database Migration &amp; Syncing](https://uql.app/migrations)

---

## 🛠 Deep Dive: Tests & Technical Resources

For those who want to see the "engine under the hood," check out these resources in the source code:

- **Entity Mocks**: See how complex entities and virtual fields are defined in [entityMock.ts](https://github.com/rogerpadilla/uql/blob/main/packages/core/src/test/entityMock.ts).
- **Core Dialect Logic**: The foundation of our context-aware SQL generation in [abstractSqlDialect.ts](https://github.com/rogerpadilla/uql/blob/main/packages/core/src/dialect/abstractSqlDialect.ts).
- **Comprehensive Test Suite**:
  - [Abstract SQL Spec](https://github.com/rogerpadilla/uql/blob/main/packages/core/src/dialect/abstractSqlDialect-spec.ts): Base test suite for all dialects.
  - [PostgreSQL](https://github.com/rogerpadilla/uql/blob/main/packages/core/src/postgres/postgresDialect.spec.ts) \| [MySQL](https://github.com/rogerpadilla/uql/blob/main/packages/core/src/mysql/mysqlDialect.spec.ts) \| [SQLite](https://github.com/rogerpadilla/uql/blob/main/packages/core/src/sqlite/sqliteDialect.spec.ts) specs.
  - [Querier Integration Tests](https://github.com/rogerpadilla/uql/blob/main/packages/core/src/querier/abstractSqlQuerier-spec.ts): SQL generation & connection management tests.

---

## Built with ❤️ and supported by

UQL is an open-source project proudly sponsored by **[Variability.ai](https://variability.ai)**.
