<!-- ![code](/assets/code.webp 'code') -->

[![tests](https://github.com/rogerpadilla/nukak/actions/workflows/tests.yml/badge.svg)](https://github.com/rogerpadilla/nukak) [![coverage status](https://coveralls.io/repos/rogerpadilla/nukak/badge.svg?branch=main)](https://coveralls.io/r/rogerpadilla/nukak?branch=main) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/rogerpadilla/nukak/blob/main/LICENSE) [![npm version](https://badge.fury.io/js/nukak.svg)](https://badge.fury.io/js/nukak)

[nukak](https://nukak.org) is the [smartest ORM](https://medium.com/@rogerpadillac/in-search-of-the-perfect-orm-e01fcc9bce3d) for TypeScript, it is designed to be fast, safe, and easy to integrate into any application.

[nukak](https://nukak.org) can run in Node.js, Browser, Cordova, PhoneGap, Ionic, React Native, NativeScript, Expo, Electron, Bun and Deno.

[nukak](https://nukak.org) has a consistent API for distinct databases, including PostgreSQL, MySQL, MariaDB, and SQLite.

&nbsp;

```ts
const companyUsers = await userRepository.findMany({
  $select: { email: true, profile: ['picture'] },
  $where: { email: { $endsWith: '@example.com' } },
  $sort: { createdAt: -1 },
  $limit: 100,
});
```

&nbsp;

## Why nukak?

See [this article](https://medium.com/@rogerpadillac/in-search-of-the-perfect-orm-e01fcc9bce3d) in medium.com.

&nbsp;

## Features

- **Type-safe and Context-aware queries**: squeeze the powers of `TypeScript` so it auto-completes and validates, the appropriate operators on any level of the queries, [including the relations and their fields](https://www.nukak.org/docs/querying-relations).
- **Serializable queries**: its [syntax](https://nukak.org/docs/querying-logical-operators) can be `100%` valid `JSON` allowing the queries to be transported across platforms with ease.
- **Unified API across Databases**: same query is transparently transformed according to the configured database.
- **FP + OOP**: Combines the best elements of `FP` (Functional Programming) and `OOP` (Object Oriented Programming).
- [Declarative](https://nukak.org/docs/transactions-declarative) and [imperative](https://nukak.org/docs/transactions-imperative) `transactions` for flexibility, and `connection pooling` for scalability.
- Transparent support for [inheritance between entities](https://nukak.org/docs/entities-inheritance) for reusability and consistency.
- Modern [Pure ESM](https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c): `ESM` is natively supported by Node.js 16 and later.
- **High performance**: the [generated queries](https://www.nukak.org/docs/querying-logical-operators) are fast, safe, and human-readable.
- Supports the [Data Mapper](https://en.wikipedia.org/wiki/Data_mapper_pattern) pattern for maintainability.
- [soft-delete](https://nukak.org/docs/entities-soft-delete), [virtual fields](https://nukak.org/docs/entities-virtual-fields), [repositories](https://nukak.org/docs/querying-repository).
- Automatic handing of `json`, `jsonb` and `vector` fields.

&nbsp;

## 1. Install

1. Install the core package:

   ```sh
   npm install nukak --save
   ```

2. Install one of the specific adapters for your database:

| Database     | Driver           | Nukak Adapter    |
| ------------ | ---------------- | ---------------- |
| `PostgreSQL` | `pg`             | `nukak-postgres` |
| `SQLite`     | `sqlite sqlite3` | `nukak-sqlite`   |
| `MariaDB`    | `mariadb`        | `nukak-maria`    |
| `MySQL`      | `mysql2`         | `nukak-mysql`    |

For example, for `Postgres`:

```sh
npm install pg nukak-postgres --save
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

Take any dump class (aka DTO) and annotate it with the decorators from `nukak/entity`.

```ts
import { randomUUID } from 'node:crypto';
import { Id, Field, Entity } from 'nukak/entity';

/**
 * any class can be annotated with this decorator to make it works as
 * an entity.
 */
@Entity()
export class User {
  /**
   * an entity must specify an ID Field, its name and type are automatically detected.
   * the `onInsert` property can be used to specify a custom mechanism for
   * auto-generating the primary-key's value when inserting.
   */
  @Id({ onInsert: () => randomUUID })
  id?: string;

  /**
   * the properties of the class can be annotated with this decorator so they
   * are interpreted as a column, its name and type are automatically detected.
   */
  @Field()
  name?: string;

  /**
   * fields are `updatable: true` by default but can also be marked as `updatable: false` so they can only be inserted and read after.
   */
  @Field({ updatable: false })
  email?: string;

  /**
   * fields are `eager: true` by default but can also be marked as `eager: false` (aka lazy fields).
   */
  @Field({ eager: false })
  password?: string;
}
```

&nbsp;

## 3. Setup a querier-pool

A querier-pool can be set in any of the bootstrap files of your app (e.g. in the `server.ts`).

```ts
// file: ./shared/orm.ts

import { PgQuerierPool } from 'nukak-postgres';

export const querierPool = new PgQuerierPool(
  {
    host: 'localhost',
    user: 'theUser',
    password: 'thePassword',
    database: 'theDatabase',
  },
  // optionally, a logger can be passed to log the generated SQL queries
  { logger: console.debug },
);
```

&nbsp;

## 4. Manipulate the data

```ts
import { querierPool } from './shared/orm.js';
import { User } from './shared/models/index.js';

async function findLastUsers(limit = 100) {
  const querier = await querierPool.getQuerier();
  try {
    const users = await querier.findMany(User, {
      $select: { id: true, name: true, email: true },
      $sort: { createdAt: 'desc' },
      $limit: limit,
    });
    return users;
  } finally {
    await querier.release();
  }
}

async function createUser(data: User) {
  const querier = await querierPool.getQuerier();
  try {
    const id = await querier.insertOne(User, data);
    return id;
  } finally {
    await querier.release();
  }
}
```

&nbsp;

Learn more about `nukak` at its website https://nukak.org
