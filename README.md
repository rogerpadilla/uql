<!-- ![code](/assets/code.webp 'code') -->

[![uql maku](https://uql.org/uql-maku.jpg)](https://uql.org)

[![tests](https://github.com/rogerpadilla/uql/actions/workflows/tests.yml/badge.svg)](https://github.com/rogerpadilla/uql) [![coverage status](https://coveralls.io/repos/rogerpadilla/uql/badge.svg?branch=main)](https://coveralls.io/r/rogerpadilla/uql?branch=main) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/rogerpadilla/uql/blob/main/LICENSE) [![npm version](https://badge.fury.io/js/uql.svg)](https://badge.fury.io/js/uql)

[uql](https://uql.org) is the [smartest ORM](https://medium.com/@rogerpadillac/in-search-of-the-perfect-orm-e01fcc9bce3d) for TypeScript, it is designed to be fast, safe, and easy to integrate into any application.

It can run in Node.js, Browser, React Native, NativeScript, Expo, Electron, Deno, Bun, and much more!

Uses a consistent API for distinct databases, including PostgreSQL, MySQL, MariaDB, and SQLite (inspired by MongoDB glorious syntax).

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

## Why uql?

See [this article](https://medium.com/@rogerpadillac/in-search-of-the-perfect-orm-e01fcc9bce3d) in medium.com.

&nbsp;

## Features

- **Type-safe and Context-aware queries**: Squeeze the power of `TypeScript` for auto-completion and validation of operators at any depth, [including relations and their fields](https://www.uql.org/docs/querying-relations).
- **Context-Object SQL Generation**: Uses a sophisticated `QueryContext` pattern to ensure perfectly indexed placeholders ($1, $2, etc.) and robust SQL fragment management, even in the most complex sub-queries.
- **Unified API across Databases**: Write once, run anywhere. Seamlessly switch between `PostgreSQL`, `MySQL`, `MariaDB`, `SQLite`, and even `MongoDB`.
- **Serializable JSON Syntax**: Queries can be expressed as `100%` valid `JSON`, allowing them to be easily transported from frontend to backend.
- **Naming Strategies**: Effortlessly translate between TypeScript `CamelCase` and database `snake_case` (or any custom format) with a pluggable system.
- **Built-in Serialization**: A centralized task queue and `@Serialized()` decorator ensure database operations are thread-safe and race-condition free by default.
- **Database Migrations**: Integrated migration system for version-controlled schema management and auto-generation from entities.
- **High Performance**: Optimized "Sticky Connections" and human-readable, minimal SQL generation.
- **Modern Architecture**: Pure `ESM` support, designed for `Node.js`, `Bun`, `Deno`, and even mobile/browser environments.
- **Rich Feature Set**: [Soft-delete](https://uql.org/docs/entities-soft-delete), [virtual fields](https://uql.org/docs/entities-virtual-fields), [repositories](https://uql.org/docs/querying-repository), and automatic handling of `JSON`, `JSONB`, and `Vector` types.

&nbsp;

## 1. Install

1. Install the core package:

   ```sh
   npm install uql --save
   ```

2. Install one of the specific adapters for your database:

| Database     | Driver           | UQL Adapter    |
| ------------ | ---------------- | ---------------- |
| `PostgreSQL` | `pg`             | `uql-postgres` |
| `SQLite`     | `sqlite sqlite3` | `uql-sqlite`   |
| `MariaDB`    | `mariadb`        | `uql-maria`    |
| `MySQL`      | `mysql2`         | `uql-mysql`    |

&nbsp;

For example, for `Postgres` install the `pg` driver and the `uql-postgres` adapter:

```sh
npm install pg uql-postgres --save
```

3. Additionally, your `tsconfig.json` may need the following flags:

   ```json
   "target": "es2022",
   "experimentalDecorators": true,
   "emitDecoratorMetadata": true
   ```

&nbsp;

---

&nbsp;

## 2. Define the entities

Annotate your classes with decorators from `uql/entity`. UQL supports detailed schema metadata for precise DDL generation.

```ts
import { Entity, Id, Field, OneToOne, OneToMany, ManyToOne, ManyToMany } from 'uql/entity';
import type { Relation } from 'uql/type';

@Entity()
export class User {
  @Id()
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
  @Id()
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
  @Id()
  id?: string;

  @Field()
  name?: string;
}

@Entity()
export class PostTag {
  @Id()
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
import { SnakeCaseNamingStrategy } from 'uql';
import { PgQuerierPool } from 'uql-postgres';

export const querierPool = new PgQuerierPool(
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
import { GenericRepository } from 'uql/repository';
import { User } from './shared/models/index.js';
import { querierPool } from './shared/orm.js';

// Get a querier from the pool
const querier = await querierPool.getQuerier();

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
      email: { $iincludes: 'uql' }, // Case-insensitive search
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
import { GenericRepository } from 'uql/repository';
import { User } from './shared/models/index.js';
import { querierPool } from './shared/orm.js';

const authorsWithPopularPosts = await querierPool.transaction(async (querier) => {
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
import { Entity, Id, Field } from 'uql/entity';
import { raw } from 'uql/util';
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
import { User, Profile } from './shared/models/index.js';
import { querierPool } from './shared/orm.js';

const result = await querierPool.transaction(async (querier) => {
  const user = await querier.findOne(User, { $where: { email: '...' } });
  const profileId = await querier.insertOne(Profile, { userId: user.id, ... });
  return { userId: user.id, profileId };
});
// Connection is automatically released after transaction
```

&nbsp;

## 5. Migrations & Synchronization

UQL provides a robust migration system and an "Entity-First" synchronization engine to manage your database schema changes.

1. Install the migration package:

   ```sh
   npm install uql-migrate --save
   ```

2. Create a `uql.config.ts` for the CLI:

   ```ts
   import { PgQuerierPool } from 'uql-postgres';
   import { User, Post, Profile } from './src/entities/index.js';
   import { SnakeCaseNamingStrategy } from 'uql';

   export default {
     querierPool: new PgQuerierPool({ /* config */ }),
     dialect: 'postgres',
     entities: [User, Post, Profile],
     namingStrategy: new SnakeCaseNamingStrategy(),
     migrationsPath: './migrations'
   };
   ```

3. Manage your schema via CLI:

   ```sh
   # Generate a migration by comparing entities vs database
   npx uql-migrate generate:entities initial_schema

   # Run pending migrations
   npx uql-migrate up

   # Rollback the last migration
   npx uql-migrate down
   ```

### Entity-First Synchronization (Development)

In development, you can use `autoSync` to automatically keep your database in sync with your entities without manual migrations. It is **safe by default**, meaning it only adds missing tables and columns.

```ts
import { Migrator } from 'uql-migrate';
import { querierPool } from './shared/orm.js';

const migrator = new Migrator(querierPool);

// Automatically sync changes on your entities with the DB tables/columns (recommended for development only)
const migrator = new Migrator(querierPool);
await migrator.autoSync({ logging: true });
```

Check out the full [uql-migrate README](packages/uql-migrate/README.md) for detailed CLI commands and advanced usage.

&nbsp;

Check out the full documentation at [uql.org](https://uql.org) for details on:
- [Complex Logical Operators](https://uql.org/docs/querying-logical-operators)
- [Relationship Mapping (1-1, 1-M, M-M)](https://uql.org/docs/querying-relations)
- [Soft Deletes & Auditing](https://uql.org/docs/entities-soft-delete)
- [Database Migration & Syncing](https://uql.org/docs/migrations)

---

## 🛠 Deep Dive: Tests & Technical Resources

For those who want to see the "engine under the hood," check out these resources in the source code:

- **Entity Mocks**: See how complex entities and virtual fields are defined in [entityMock.ts](https://github.com/rogerpadilla/uql/blob/main/packages/core/src/test/entityMock.ts).
- **Core Dialect Logic**: The foundation of our context-aware SQL generation in [abstractSqlDialect.ts](https://github.com/rogerpadilla/uql/blob/main/packages/core/src/dialect/abstractSqlDialect.ts).
- **Comprehensive Test Suite**:
  - [Abstract SQL Spec](https://github.com/rogerpadilla/uql/blob/main/packages/core/src/dialect/abstractSqlDialect-spec.ts): The base test suite shared by all dialects.
  - [PostgreSQL Spec](https://github.com/rogerpadilla/uql/blob/main/packages/postgres/src/postgresDialect.spec.ts) | [MySQL Spec](https://github.com/rogerpadilla/uql/blob/main/packages/mysql/src/mysqlDialect.spec.ts) | [SQLite Spec](https://github.com/rogerpadilla/uql/blob/main/packages/sqlite/src/sqliteDialect.spec.ts).
  - [Querier Integration Tests](https://github.com/rogerpadilla/uql/blob/main/packages/core/src/querier/abstractSqlQuerier-spec.ts): Testing the interaction between SQL generation and connection management.
