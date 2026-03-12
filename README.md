<!-- ![code](/assets/code.webp 'code') -->

<a href="https://uql-orm.dev"><img src="assets/logo.svg" alt="uql" width="80" /></a>

[![tests](https://github.com/rogerpadilla/uql/actions/workflows/tests.yml/badge.svg)](https://github.com/rogerpadilla/uql) [![Coverage Status](https://coveralls.io/repos/github/rogerpadilla/uql/badge.svg?branch=main)](https://coveralls.io/github/rogerpadilla/uql?branch=main) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/rogerpadilla/uql/blob/main/LICENSE) [![npm version](https://img.shields.io/npm/v/uql-orm.svg)](https://www.npmjs.com/package/uql-orm) [![Discord](https://img.shields.io/badge/Discord-Join%20Us-5865F2?logo=discord&logoColor=white)](https://discord.gg/DHJYp6MDS7)

**[UQL](https://uql-orm.dev)** is the [smartest ORM](https://medium.com/@rogerpadillac/in-search-of-the-perfect-orm-e01fcc9bce3d) for TypeScript. It is engineered to be **fast**, **safe**, and **universally compatible**.


```ts
const users = await querier.findMany(User, {
  $select: { name: true, profile: { $select: { picture: true } } },
  $where: { name: { $istartsWith: 'a' }, posts: { tags: { name: 'typescript' } } },
  $sort: { createdAt: 'desc' },
  $limit: 10,
});
```

&nbsp;

## Features

| Feature                                                                  | Description                                                                                                                     |
| :----------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| **[Intelligent Querying](https://uql-orm.dev/querying/relations)**       | Deep auto-completion for operators and [relations](https://uql-orm.dev/querying/relations) at any depth.                         |
| **Serializable JSON**                                              | 100% valid JSON queries for easy transport over HTTP/Websockets.                                                                |
| **Unified Dialects**                                               | Write once, run anywhere: PostgreSQL, MySQL, SQLite, MongoDB, and more.                                                         |
| **[Naming Strategies](https://uql-orm.dev/naming-strategy)**           | Pluggable system to translate between TypeScript `camelCase` and database `snake_case`.                                     |
| **Smart SQL Engine**                                               | Optimized sub-queries, placeholders ($1, $2), and minimal SQL generation via `QueryContext`.                                  |
| **Thread-Safe by Design**                                          | Centralized task queue and `@Serialized()` decorator prevent race conditions.                                                 |
| **[Declarative Transactions](https://uql-orm.dev/querying/transactions)**  | Standard `@Transactional()` and `@InjectQuerier()` decorators for NestJS/DI.                                                |
| **[Lifecycle Hooks](https://uql-orm.dev/entities/lifecycle-hooks)**| `@BeforeInsert`, `@AfterLoad` and 5 more decorators for validation, timestamps, and computed fields.                        |
| **[Aggregate Queries](https://uql-orm.dev/querying/aggregate)** | `GROUP BY`, `HAVING`, `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, and `DISTINCT` across all dialects. |
| **[Semantic Search](https://uql-orm.dev/querying/semantic-search)** | Vector similarity via `$sort` with `$vector`/`$distance`. Supports `vector`, `halfvec`, `sparsevec` types, HNSW/IVFFlat indexes, and 5 distance metrics across Postgres, MariaDB, and SQLite. |
| **[Modern & Versatile](https://uql-orm.dev/entities/virtual-fields)** | **Pure ESM**, high-res timing, [Soft-delete](https://uql-orm.dev/entities/soft-delete), and **JSONB/JSON** support. |
| **[Database Migrations](https://www.uql-orm.dev/migrations)**          | Built-in [Entity-First synchronization](https://uql-orm.dev/migrations#3-entity-first-synchronization-development) and a robust CLI for version-controlled schema evolution. |
| **[Logging & Monitoring](https://www.uql-orm.dev/logging)**               | Professional-grade monitoring with slow-query detection and colored output.                                                     |

&nbsp;

## 1. Install

Install the core package and the driver for your database:

```sh
# Core
npm install uql-orm       # or bun add / pnpm add
```

### Supported Drivers (pick according to your database)

| Database                                               | Command                        |
| :----------------------------------------------------- | :----------------------------- |
| **PostgreSQL** (incl. Neon, Cockroach, Yugabyte) | `npm install pg`             |
| **MySQL** (incl. TiDB, Aurora)                   | `npm install mysql2`         |
| **MariaDB**                                      | `npm install mariadb`        |
| **SQLite**                                       | `npm install better-sqlite3` |
| **LibSQL** (incl. Turso)                         | `npm install @libsql/client` |
| **MongoDB**                                      | `npm install mongodb`        |
| **Cloudflare D1**                                | _Native (no driver needed)_  |

### TypeScript Configuration

Ensure your `tsconfig.json` is configured to support decorators and metadata:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

&nbsp;**Note:** UQL is Modern Pure ESM — ensure your project's `module` supports ESM imports (e.g., `NodeNext`, `ESNext`, `Bundler`).

## 2. Define the Entities

Annotate your classes with decorators. UQL's engine uses this metadata for both type-safe querying and precise DDL generation.

### Core Decorators

| Decorator       | Purpose                                                                        |
| :-------------- | :----------------------------------------------------------------------------- |
| `@Entity()`   | Marks a class as a database table/collection.                                  |
| `@Id()`       | Defines the Primary Key with support for `onInsert` generators (UUIDs, etc). |
| `@Field()`    | Standard column. Use `{ reference: ... }` for Foreign Keys.                  |
| `@Index()`    | Defines a composite or custom index on one or more columns.                    |
| `@OneToOne`   | Defines a one-to-one relationship.                                             |
| `@OneToMany`  | Defines a one-to-many relationship.                                            |
| `@ManyToOne`  | Defines a many-to-one relationship.                                            |
| `@ManyToMany` | Defines a many-to-many relationship.                                           |
| `@Virtual()`  | Defines a read-only field calculated via SQL (see Advanced).                    |
| `@BeforeInsert` / `@AfterInsert` | Lifecycle hooks fired around `insert` operations.           |
| `@BeforeUpdate` / `@AfterUpdate` | Lifecycle hooks fired around `update` operations.           |
| `@BeforeDelete` / `@AfterDelete` | Lifecycle hooks fired around `delete` operations.           |
| `@AfterLoad`  | Lifecycle hook fired after loading entities from the database.                  |

### Type Abstraction: Logical vs. Physical

UQL separates the **intent** of your data from its **storage**. Both properties are **optional**; if omitted, UQL performs a *best-effort inference* using the TypeScript types from your class (provided `emitDecoratorMetadata` is enabled).

| Property | Purpose | Values |
| :--- | :--- | :--- |
| **`type`** | **Logical Type** (Abstraction). Used for runtime behavior and automatic SQL mapping. | `String`, `Number`, `Boolean`, `Date`, `BigInt`, or semantic strings: `'uuid'`, `'json'`, `'vector'`, `'halfvec'`, `'sparsevec'`. |
| **`columnType`** | **Physical Type** (Implementation). **Highest Priority**. Bypasses UQL's inference for exact SQL control. | Raw SQL types: `'varchar(100)'`, `'decimal(10,2)'`, `'smallint'`, etc. |

```ts
// Automatic inference from TypeScript types
@Field() name?: string;           // → TEXT (Postgres), VARCHAR(255) (MySQL)
@Field() age?: number;            // → INTEGER
@Field() isActive?: boolean;      // → BOOLEAN
@Field() createdAt?: Date;        // → TIMESTAMP

// Semantic types - portable across all databases
@Field({ type: 'uuid' })          // → UUID (Postgres), CHAR(36) (MySQL), TEXT (SQLite)
externalId?: string;

@Field({ type: 'json' })          // → JSONB (Postgres), JSON (MySQL), TEXT (SQLite)
metadata?: Json<{ theme?: string }>;

// Logical types with constraints - portable with control
@Field({ type: 'varchar', length: 500 })
bio?: string;

@Field({ type: 'decimal', precision: 10, scale: 2 })
price?: number;

// Exact SQL type - when you need dialect-specific control
@Field({ columnType: 'smallint' })
statusCode?: number;
```


&nbsp;

```ts
import { v7 as uuidv7 } from 'uuid';
import { Entity, Id, Field, OneToOne, OneToMany, ManyToOne, ManyToMany, type Relation, type Json } from 'uql-orm';

@Entity()
export class User {
  @Id({ type: 'uuid', onInsert: () => uuidv7() })
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
    mappedBy: (profile) => profile.user,
    cascade: true,
  })
  profile?: Relation<Profile>;

  @OneToMany({
    entity: () => Post,
    mappedBy: (post) => post.author,
  })
  posts?: Relation<Post>[];
}

@Entity()
export class Profile {
  @Id({ type: 'uuid', onInsert: () => uuidv7() })
  id?: string;

  @Field()
  bio?: string;

  @Field({ reference: () => User, foreignKey: 'fk_profile_user' })
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
  @Id({ type: 'uuid', onInsert: () => uuidv7() })
  id?: string;

  @Field()
  name?: string;
}

@Entity()
export class PostTag {
  @Id({ type: 'uuid', onInsert: () => uuidv7() })
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
import { SnakeCaseNamingStrategy, type Config } from 'uql-orm';
import { PgQuerierPool } from 'uql-orm/postgres'; // or mysql2, sqlite, etc.
import { User, Profile, Post } from './entities';

export const pool = new PgQuerierPool(
  { host: 'localhost', database: 'uql_app', max: 10 },
  {
    logger: ['error', 'warn', 'migration'],
    namingStrategy: new SnakeCaseNamingStrategy()
    slowQuery: { threshold: 1000 },
  }
);

export default {
  pool,
  entities: [User, Profile, Post],
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
      profile: { $select: { bio: true }, $required: true } // INNER JOIN
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

### JSONB Operators & Relation Filtering

Query nested JSON fields using **type-safe dot-notation** with full operator support. Wrap fields with `Json<T>` to get IDE autocompletion for valid paths. UQL generates the correct SQL for each dialect.

```ts
// Filter by nested JSONB field paths
const items = await querier.findMany(Company, {
  $where: {
    'settings.isArchived': { $ne: true },
    'settings.priority': { $gte: 5 },
  },
});
```

**PostgreSQL:** `WHERE ("settings"->>'isArchived') IS DISTINCT FROM $1 AND (("settings"->>'priority'))::numeric >= $2`
**SQLite:** `WHERE json_extract("settings", '$.isArchived') IS NOT ? AND CAST(json_extract("settings", '$.priority') AS REAL) >= ?`

Filter parent entities by their **ManyToMany** or **OneToMany** relations using automatic EXISTS subqueries:

```ts
// Find posts that have a tag named 'typescript'
const posts = await querier.findMany(Post, {
  $where: { tags: { name: 'typescript' } },
});
```

**PostgreSQL:** `WHERE EXISTS (SELECT 1 FROM "PostTag" WHERE "PostTag"."postId" = "Post"."id" AND "PostTag"."tagId" IN (SELECT "Tag"."id" FROM "Tag" WHERE "Tag"."name" = $1))`

> **Pro Tip**: Wrap JSONB field types with `Json<T>` (e.g., `settings?: Json<{ isArchived?: boolean }>`) to get IDE autocompletion for dot-notation paths.

&nbsp;

### Aggregate Queries

Use `querier.aggregate()` for `GROUP BY` analytics with `$count`, `$sum`, `$avg`, `$min`, `$max`, and full `$having` support.

```ts
const results = await querier.aggregate(Order, {
  $group: {
    status: true,
    total: { $sum: 'amount' },
    count: { $count: '*' },
  },
  $having: { count: { $gt: 5 } },
  $sort: { total: -1 },
  $limit: 10,
});
```

**Generated SQL (PostgreSQL):**

```sql
SELECT "status", SUM("amount") "total", COUNT(*) "count"
FROM "Order"
GROUP BY "status"
HAVING COUNT(*) > $1
ORDER BY SUM("amount") DESC
LIMIT 10
```

For `SELECT DISTINCT`, add `$distinct: true` to any find query:

```ts
const names = await querier.findMany(User, {
  $select: { name: true },
  $distinct: true,
});
// → SELECT DISTINCT "name" FROM "User"
```

> **Learn more**: See the full [Aggregate Queries guide](https://uql-orm.dev/querying/aggregate) for `$having` operators, MongoDB pipeline details, and advanced patterns.

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
import { Transactional, InjectQuerier, type Querier } from 'uql-orm';

export class UserService {
  @Transactional()
  async register({picture, ...user}: UserProfile, @InjectQuerier() querier?: Querier) {
    const userId = await querier.insertOne(User, user);
    await querier.insertOne(Profile, { userId, picture });
  }
}
```

#### Option C: Imperative

For granular control over the transaction lifecycle, manage `begin`, `commit`, `rollback`, and `release` yourself.

```ts
const querier = await pool.getQuerier();
try {
  await querier.beginTransaction();

  const userId = await querier.insertOne(User, { name: '...' });
  await querier.insertOne(Profile, { userId, picture: '...' });

  await querier.commitTransaction();
} catch (error) {
  await querier.rollbackTransaction();
  throw error;
} finally {
  await querier.release();
}
```

&nbsp;

## 5. Migrations & Synchronization

UQL takes an **Entity-First** approach: you modify your TypeScript entity classes, and UQL auto-generates the migration files for you. No need to write DDL manually — UQL diffs your entities against the live database and generates the exact SQL needed.

```bash
# 1. Update your entity (add a field, change a type, add a relation...)
# 2. Auto-generate the migration
npx uql-migrate generate:entities add_user_nickname

# 3. Review and apply
npx uql-migrate up
```

> **Your entities are the single source of truth.** Want manual migrations for data backfills or custom SQL? You can do that too — full automation + full control when you need it.

### 1. Unified Configuration

Reuse the same `uql.config.ts` for your app and the CLI to ensure consistent settings (naming strategies, entities, pool):

```ts
// uql.config.ts
import type { Config } from 'uql-orm';
import { PgQuerierPool } from 'uql-orm/postgres';
import { User, Profile, Post } from './entities';

export default {
  pool: new PgQuerierPool({ /* ... */ }),
  entities: [User, Profile, Post],
  migrationsPath: './migrations',
} satisfies Config;
```

### 2. Manage via CLI

Use the CLI to manage your database schema evolution.

| Command | Description |
| :--- | :--- |
| `generate:entities <name>` | **Auto-generates** a migration by diffing your entities against the current DB schema. |
| `generate <name>` | Creates an empty timestamped file for **manual** SQL migrations (e.g., data backfills). |
| `generate:from-db` | **Scaffolds Entities** from an existing database. Includes **Smart Relation Detection**. |
| `drift:check` | **Drift Detection**: Compares your defined entities against the actual database schema and reports discrepancies. |
| `up` | Applies all pending migrations. |
| `down` | Rolls back the last applied migration batch. |
| `status` | Shows which migrations have been executed and which are pending. |

#### Usage Examples

```bash
# 1. Auto-generate schema changes from your entities
npx uql-migrate generate:entities add_profile_table

# 2. Apply changes
npx uql-migrate up

# 3. Check for schema drift (Production Safety)
npx uql-migrate drift:check

# 4. Scaffold entities from an existing DB (Legacy Adoption)
npx uql-migrate generate:from-db --output ./src/entities

# 5. Create a manual migration (for data backfills or custom SQL)
npx uql-migrate generate seed_default_roles
```

> **Bun Users**: If your `uql.config.ts` uses TypeScript path aliases (e.g., `~app/...`), run migrations with the `--bun` flag to ensure proper resolution:
> ```bash
> bun run --bun uql-migrate status
> ```
> Or add a script to your `package.json`: `"uql": "bun run --bun uql-migrate"`, then run commands like, e.g., `bun run uql status`.

### 3. AutoSync (Development)

Keep your schema in sync without manual migrations. It is **Safe by Default**: In safe mode (default), it strictly **adds** new tables and columns but **blocks** any destructive operations (column drops or type alterations) to prevent data loss. It provides **Transparent Feedback** by logging detailed warnings for any blocked changes, so you know exactly what remains to be migrated manually.

**New Capabilities (v3.8+):**

*   **Schema AST Engine**: Uses a graph-based representation of your schema for 100% accurate diffing, handling circular dependencies and correct topological sort orders for table creation/dropping.
*   **Smart Relation Detection**: When generating entities from an existing DB, UQL automatically detects relationships (OneToOne, ManyToMany) via foreign key structures and naming conventions (`user_id` -> `User`).
*   **Bidirectional Index Sync**: Indexes defined in `@Field({ index: true })` or `@Index()` are synced to the DB, and indexes found in the DB are reflected in generated entities.

> **Important**: For `autoSync` to detect your entities, they must be **loaded** (imported) before calling `autoSync`.

**Using Your Config (Recommended)**

If you follow the [unified configuration](#1-unified-configuration) pattern, your entities are already imported. Simply reuse it:

```ts
import { Migrator } from 'uql-orm/migrate';
import config from './uql.config.js';

const migrator = new Migrator(config.pool, {
  entities: config.entities,
});
await migrator.autoSync({ logging: true });
```

**Explicit Entities**

Alternatively, pass entities directly if you want to be explicit about which entities to sync:

```ts
import { Migrator } from 'uql-orm/migrate';
import { User, Profile, Post } from './entities/index.js';

const migrator = new Migrator(pool, {
  entities: [User, Profile, Post],
});
await migrator.autoSync({ logging: true });
```

&nbsp;

## 6. Logging & Monitoring

UQL features a professional-grade, structured logging system designed for high visibility and sub-millisecond performance monitoring.

### Log Levels

| Level                 | Description                                                                             |
| :-------------------- | :-------------------------------------------------------------------------------------- |
| `query`             | **Standard Queries**: Beautifully formatted SQL/Command logs with execution time. |
| `slowQuery`         | **Bottleneck Alerts**: Dedicated logging for queries exceeding your threshold. Use `logParams: false` to omit sensitive data. |
| `error` / `warn`  | **System Health**: Detailed error traces and potential issue warnings.            |
| `migration`         | **Audit Trail**: Step-by-step history of schema changes.                          |
| `skippedMigration`  | **Safety**: Logs blocked unsafe schema changes during autoSync.                   |
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

Learn more about UQL at [uql-orm.dev](https://uql-orm.dev) for details on:

- [Complex Logical Operators](https://uql-orm.dev/querying/logical-operators)
- [Aggregate Queries (GROUP BY, HAVING, DISTINCT)](https://uql-orm.dev/querying/aggregate)
- [Semantic Search (Vector Similarity)](https://uql-orm.dev/querying/semantic-search)
- [Relationship Mapping (1-1, 1-M, M-M)](https://uql-orm.dev/querying/relations)
- [Lifecycle Hooks](https://uql-orm.dev/entities/lifecycle-hooks)
- [Soft Deletes &amp; Auditing](https://uql-orm.dev/entities/soft-delete)
- [Database Migration &amp; Syncing](https://uql-orm.dev/migrations)

&nbsp;

## 🛠 Deep Dive: Tests & Technical Resources

For those who want to see the "engine under the hood," check out these resources in the source code:

- **Entity Mocks**: See how complex entities and virtual fields are defined in [entityMock.ts](https://github.com/rogerpadilla/uql/blob/main/packages/uql-orm/src/test/entityMock.ts).
- **Core Dialect Logic**: The foundation of our context-aware SQL generation in [abstractSqlDialect.ts](https://github.com/rogerpadilla/uql/blob/main/packages/uql-orm/src/dialect/abstractSqlDialect.ts).
- **Comprehensive Test Suite**:
  - [Abstract SQL Spec](https://github.com/rogerpadilla/uql/blob/main/packages/uql-orm/src/dialect/abstractSqlDialect-spec.ts): Base test suite for all dialects.
  - [PostgreSQL](https://github.com/rogerpadilla/uql/blob/main/packages/uql-orm/src/postgres/postgresDialect.spec.ts) \| [MySQL](https://github.com/rogerpadilla/uql/blob/main/packages/uql-orm/src/mysql/mysqlDialect.spec.ts) \| [SQLite](https://github.com/rogerpadilla/uql/blob/main/packages/uql-orm/src/sqlite/sqliteDialect.spec.ts) specs.
  - [Querier Integration Tests](https://github.com/rogerpadilla/uql/blob/main/packages/uql-orm/src/querier/abstractSqlQuerier-spec.ts): SQL generation & connection management tests.

&nbsp;

## Built with ❤️ and supported by

UQL is an open-source project proudly sponsored by **[Variability.ai](https://variability.ai)**.
