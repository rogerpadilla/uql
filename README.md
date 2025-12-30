<!-- ![code](/assets/code.webp 'code') -->

[![uql maku](assets/logo.svg)](https://uql.app)

[![tests](https://github.com/rogerpadilla/uql/actions/workflows/tests.yml/badge.svg)](https://github.com/rogerpadilla/uql) [![Coverage Status](https://coveralls.io/repos/github/rogerpadilla/uql/badge.svg?branch=main)](https://coveralls.io/github/rogerpadilla/uql?branch=main) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/rogerpadilla/uql/blob/main/LICENSE) [![npm version](https://img.shields.io/npm/v/@uql/core.svg)](https://www.npmjs.com/package/@uql/core)

**[UQL](https://uql.app)** is the [smartest ORM](https://medium.com/@rogerpadillac/in-search-of-the-perfect-orm-e01fcc9bce3d) for TypeScript. It is engineered to be **fast**, **safe**, and **universally compatible**.

- **Runs Everywhere**: Node.js, Bun, Deno, Cloudflare Workers, Electron, React Native, and even the Browser.

- **Unified API**: A consistent, expressive query interface for PostgreSQL, MySQL, MariaDB, SQLite, LibSQL, Neon, Cloudflare D1, and MongoDB (inspired by its glorious syntax).

&nbsp;

```ts
const companyUsers = await userRepository.findMany({
  $select: { email: true, profile: { $select: { picture: true } } },
  $where: { email: { $endsWith: '@domain.com' } },
  $sort: { createdAt: 'desc' },
  $limit: 100,
});
```

&nbsp;

## Why UQL?

See [this article](https://medium.com/@rogerpadillac/in-search-of-the-perfect-orm-e01fcc9bce3d) in medium.com.

&nbsp;

## Features

- **Type-safe and Context-aware queries**: Squeeze the power of `TypeScript` for auto-completion and validation of operators at any depth, [including relations and their fields](https://www.uql.app/docs/querying-relations).
- **Context-Object SQL Generation**: Uses a sophisticated `QueryContext` pattern to ensure perfectly indexed placeholders ($1, $2, etc.) and robust SQL fragment management, even in the most complex sub-queries.
- **Unified API across Databases**: Write once, run anywhere. Seamlessly switch between `PostgreSQL`, `MySQL`, `MariaDB`, `SQLite`, `LibSQL`, `Neon`, `Cloudflare D1`, and even `MongoDB`.
- **Serializable JSON Syntax**: Queries can be expressed as `100%` valid `JSON`, allowing them to be easily transported from frontend to backend.
- **Naming Strategies**: Effortlessly translate between TypeScript `CamelCase` and database `snake_case` (or any custom format) with a pluggable system.
- **Built-in Serialization**: A centralized task queue and `@Serialized()` decorator ensure database operations are thread-safe and race-condition free by default.
- **Database Migrations**: Integrated migration system for version-controlled schema management and auto-generation from entities.
- **High Performance**: Optimized "Sticky Connections" and human-readable, minimal SQL generation.
- **Modern Architecture**: Pure `ESM` support, designed for `Node.js`, `Bun`, `Deno`, and even mobile/browser environments.
- **Rich Feature Set**: [Soft-delete](https://uql.app/docs/entities-soft-delete), [virtual fields](https://uql.app/docs/entities-virtual-fields), [repositories](https://uql.app/docs/querying-repository), and automatic handling of `JSON`, `JSONB`, and `Vector` types.

&nbsp;

## 1. Install

1. Install the core package:

   ```sh
   npm install @uql/core
   # or
   bun add @uql/core
   ```

2. Install one of the specific adapters for your database:

| Database | Driver
| :--- | :---
| `PostgreSQL` (incl. CockroachDB, YugabyteDB) | `pg`
| `MySQL` (incl. TiDB, Aurora) | `mysql2`
| `MariaDB` | `mariadb`
| `SQLite` | `better-sqlite3`
| `Cloudflare D1` | `Native Binding`
| `LibSQL` (Turso) | `@libsql/client`
| `Neon` (Serverless Postgres) | `@neondatabase/serverless`

&nbsp;

For example, for `Postgres` install the `pg` driver:

```sh
npm install pg
# or
bun add pg
```

3. Additionally, your `tsconfig.json` may need the following flags:

   ```json
   "target": "ES2024",
   "experimentalDecorators": true,
   "emitDecoratorMetadata": true
   ```

> **Note**: `"ES2022"`, `"ES2023"`, or `"ESNext"` will also work fine for `target`.

---

&nbsp;

## 2. Define the entities

Annotate your classes with decorators from `@uql/core`. UQL supports detailed schema metadata for precise DDL generation.

```ts
import { v7 as uuidv7 } from 'uuid';
import { Entity, Id, Field, OneToOne, OneToMany, ManyToOne, ManyToMany, type Relation } from '@uql/core';

@Entity()
export class User {
  @Id({ onInsert: () => uuidv7() })
  id?: string;

  @Field({ length: 100, index: true })
  name?: string;

  @Field({ unique: true, comment: 'User login email' })
  email?: string;

  @OneToOne({ entity: () => Profile, mappedBy: 'user', cascade: true })
  profile?: Relation<Profile>; // Relation<T> handles circular dependencies

  @OneToMany({ entity: () => Post, mappedBy: 'author' })
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

  @ManyToMany({ entity: () => Tag, through: () => PostTag })
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

&nbsp;

## 3. Setup a querier-pool

A querier-pool can be set in any of the bootstrap files of your app (e.g. in the `server.ts`).

```ts
// file: ./shared/orm.ts
import { SnakeCaseNamingStrategy } from '@uql/core';
import { PgQuerierPool } from '@uql/core/postgres';

export const pool = new PgQuerierPool(
  {
    host: 'localhost',
    user: 'theUser',
    password: 'thePassword',
    database: 'theDatabase',
    min: 1,
    max: 10,
  },
  // Optional extra options.
  {
    // Optional, any custom logger function can be passed here (optional).
    logger: console.debug,
    // Automatically translate between TypeScript camelCase and database snake_case.
    // This affects both queries and schema generation.
    namingStrategy: new SnakeCaseNamingStrategy()
  },
);
```

&nbsp;

## 4. Manipulate the data

UQL provides multiple ways to interact with your data, from low-level `Queriers` to high-level `Repositories`.

### Using Repositories (Recommended)

Repositories provide a clean, Data-Mapper style interface for your entities.

```ts
import { GenericRepository } from '@uql/core';
import { User } from './shared/models/index.js';
import { pool } from './shared/orm.js';

// Get a querier from the pool
const querier = await pool.getQuerier();

try {
  const userRepository = new GenericRepository(User, querier);

  // Advanced querying with relations and virtual fields
  const users = await userRepository.findMany({
    $select: {
      id: true,
      name: true,
      profile: ['picture'], // Select specific fields from a 1-1 relation
      tagsCount: true       // Virtual field (calculated at runtime)
    },
    $where: {
      email: { $iincludes: '@example.com' }, // Case-insensitive search
      status: 'active'
    },
    $sort: { createdAt: -1 },
    $limit: 50
  });
} finally {
  // Always release the querier to the pool
  await querier.release();
}
```

### Advanced: Deep Selection & Filtering

UQL's query syntax is context-aware. When you query a relation, the available fields and operators are automatically suggested and validated based on that related entity.

```ts
import { GenericRepository } from '@uql/core';
import { pool } from './shared/orm.js';
import { User } from './shared/models/index.js';

const authorsWithPopularPosts = await pool.transaction(async (querier) => {
  const userRepository = new GenericRepository(User, querier);

  return userRepository.findMany({
    $select: {
      id: true,
      name: true,
      profile: {
        $select: ['bio'],
        // Filter related record and enforce INNER JOIN
        $where: { bio: { $ne: null } },
        $required: true
      },
      posts: {
        $select: ['title', 'createdAt'],
        // Filter the related collection directly
        $where: { title: { $iincludes: 'typescript' } },
        $sort: { createdAt: -1 },
        $limit: 5
      }
    },
    $where: {
      name: { $istartsWith: 'a' }
    }
  });
});
```

### Advanced: Virtual Fields & Raw SQL

Define complex logic directly in your entities using `raw` functions from `uql/util`. These are highly efficient as they are resolved during SQL generation.

```ts
import { v7 as uuidv7 } from 'uuid';
import { Entity, Id, Field, raw } from '@uql/core';
import { ItemTag } from './shared/models/index.js';

@Entity()
export class Item {
  @Id()
  id: number;

  @Field()
  name: string;

  @Field({
    virtual: raw(({ ctx, dialect, escapedPrefix }) => {
      ctx.append('(');
      dialect.count(ctx, ItemTag, {
        $where: {
          itemId: raw(({ ctx }) => ctx.append(`${escapedPrefix}.id`))
        }
      }, { autoPrefix: true });
      ctx.append(')');
    })
  })
  tagsCount?: number;
}
```

### Thread-Safe Transactions

UQL ensures your operations are serialized and thread-safe.

```ts
import { pool } from './shared/orm.js';
import { User, Profile } from './shared/models/index.js';

const result = await pool.transaction(async (querier) => {
  const user = await querier.findOne(User, { $where: { email: '...' } });
  const profileId = await querier.insertOne(Profile, { userId: user.id, ... });
  return { userId: user.id, profileId };
});
// Connection is automatically released after transaction
```

&nbsp;

## 5. Migrations & Synchronization

UQL includes a robust migration system and an "Entity-First" synchronization engine built directly into the core.

### 1. Create Configuration

Create a `uql.config.ts` file in your project root:

```typescript
import { PgQuerierPool } from '@uql/core/postgres';
import { User, Post } from './shared/models/index.js';

export default {
  pool: new PgQuerierPool({ /* config */ }),
  entities: [User, Post],
  migrationsPath: './migrations',
};
```

### 2. Manage via CLI

UQL provides a dedicated CLI tool for migrations.

```bash
# Generate a migration by comparing entities vs database
npx uql-migrate generate:entities initial_schema
# or
bunx uql-migrate generate:entities initial_schema

# Run pending migrations
npx uql-migrate up
# or
bunx uql-migrate up

# Rollback the last migration
npx uql-migrate down
# or
bunx uql-migrate down

# Check status
npx uql-migrate status
# or
bunx uql-migrate status
```

### 3. Entity-First Synchronization (Development)

In development, you can use `autoSync` to automatically keep your database in sync with your entities without manual migrations. It is **safe by default**, meaning it only adds missing tables and columns.

```ts
import { Migrator } from '@uql/core/migrate';
import { pool } from './shared/orm.js';

const migrator = new Migrator(pool);
await migrator.autoSync({ logging: true });
```

Check out the full [documentation](https://uql.app/docs/migrations) for detailed CLI commands and advanced usage.

&nbsp;

Check out the full documentation at [uql.app](https://uql.app) for details on:
- [Complex Logical Operators](https://uql.app/docs/querying-logical-operators)
- [Relationship Mapping (1-1, 1-M, M-M)](https://uql.app/docs/querying-relations)
- [Soft Deletes & Auditing](https://uql.app/docs/entities-soft-delete)
- [Database Migration & Syncing](https://uql.app/docs/migrations)

---

## 🛠 Deep Dive: Tests & Technical Resources

For those who want to see the "engine under the hood," check out these resources in the source code:

- **Entity Mocks**: See how complex entities and virtual fields are defined in [entityMock.ts](https://github.com/rogerpadilla/uql/blob/main/packages/core/src/test/entityMock.ts).
- **Core Dialect Logic**: The foundation of our context-aware SQL generation in [abstractSqlDialect.ts](https://github.com/rogerpadilla/uql/blob/main/packages/core/src/dialect/abstractSqlDialect.ts).
- **Comprehensive Test Suite**:
  - [Abstract SQL Spec](https://github.com/rogerpadilla/uql/blob/main/packages/core/src/dialect/abstractSqlDialect-spec.ts): The base test suite shared by all dialects.
  - [PostgreSQL Spec](https://github.com/rogerpadilla/uql/blob/main/packages/core/src/postgres/postgresDialect.spec.ts) | [MySQL Spec](https://github.com/rogerpadilla/uql/blob/main/packages/core/src/mysql/mysqlDialect.spec.ts) | [SQLite Spec](https://github.com/rogerpadilla/uql/blob/main/packages/core/src/sqlite/sqliteDialect.spec.ts).
  - [Querier Integration Tests](https://github.com/rogerpadilla/uql/blob/main/packages/core/src/querier/abstractSqlQuerier-spec.ts): Testing the interaction between SQL generation and connection management.
  - [MongoDB Migration Tests](https://github.com/rogerpadilla/uql/blob/main/packages/core/src/migrate/migrator-mongo.it.ts): Integration tests ensuring correct collection and index synchronization for MongoDB.

---

## Built with ❤️ and supported by

UQL is an open-source project driven by the community and proudly sponsored by **[Variability.ai](https://variability.ai)**.

> "Intelligence in Every Fluctuation"

Their support helps us maintain and evolve the "Smartest ORM" for developers everywhere. Thank you for being part of our journey!
