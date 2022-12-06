![code](/assets/code.webp 'code')

[![tests](https://github.com/rogerpadilla/nukak/actions/workflows/tests.yml/badge.svg)](https://github.com/rogerpadilla/nukak) [![coverage status](https://coveralls.io/repos/rogerpadilla/nukak/badge.svg?branch=main)](https://coveralls.io/r/rogerpadilla/nukak?branch=main) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/rogerpadilla/nukak/blob/main/LICENSE) [![npm version](https://badge.fury.io/js/nukak.svg)](https://badge.fury.io/js/nukak)

[nukak](https://nukak.org) is a powerful and efficient `ORM`, designed from the ground up to be fast, secure, and easy to use. It is inspired by other `ORMs` such as [TypeORM](https://typeorm.io) and [MongoDB driver](https://www.mongodb.com/docs/drivers/node/current/fundamentals/crud/query-document/), and has been designed to rely on serializable `JSON` syntax for easy transport across platforms.

&nbsp;

## Features

- Takes full advantage of `TypeScript` intelligent type-inference [everywhere](https://nukak.org/docs/querying-relations).
- Serializable `JSON` syntax for all the [queries](https://nukak.org/docs/querying-logical-operators).
- Querying data with `$project`, `$filter`, `$sort`, `$limit`, works at [multiple levels](https://nukak.org/docs/querying-relations) (including deep relations and their fields).
- Supports the Data Mapper pattern.
- The generated queries are [performant](https://nukak.org/docs/querying-relations), safe, and human-readable.
- [soft-delete](https://nukak.org/docs/entities-soft-delete), [virtual fields](https://nukak.org/docs/entities-virtual-fields), [repositories](https://nukak.org/docs/querying-repository), `connection pooling`.
- Transparent support for [inheritance](https://nukak.org/docs/entities-inheritance) between entities.
- Modern [Pure ESM](https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c) approach. `ESM` is natively supported by Node.js 12 and later.
- [Declarative](https://nukak.org/docs/transactions-declarative) and [imperative](https://nukak.org/docs/transactions-imperative) `transactions`.
- Unified API for `MySQL`, `MariaDB`, `SQLite`, `Postgres`, `MongoDB`.

&nbsp;

## Install

1. Install the core package:

   ```sh
   npm install nukak --save
   ```

2. Install one of the specific adapters for your database:

| Database     | Driver           | Nukak Adapter    |
| ------------ | ---------------- | ---------------- |
| `MySQL`      | `mysql2`         | `nukak-mysql`    |
| `MariaDB`    | `mariadb`        | `nukak-maria`    |
| `SQLite`     | `sqlite sqlite3` | `nukak-sqlite`   |
| `PostgreSQL` | `pg`             | `nukak-postgres` |
| `MongoDB`    | `mongodb`        | `nukak-mongo`    |

For example, for `Postgres`:

```sh
npm install pg nukak-postgres --save
```

3. Additionally, your `tsconfig.json` may need the following flags:

   ```json
   "target": "es2020",
   "experimentalDecorators": true,
   "emitDecoratorMetadata": true
   ```

&nbsp;

## Configure

A default querier-pool can be set in any of the bootstrap files of your app (e.g. in the `server.ts`).

```ts
import { setQuerierPool } from 'nukak';
import { PgQuerierPool } from 'nukak-postgres';

export const querierPool = new PgQuerierPool(
  {
    host: 'localhost',
    user: 'theUser',
    password: 'thePassword',
    database: 'theDatabase',
  },
  // optionally, a logger can be passed to log the generated SQL queries
  { logger: console.log }
);

// the default querier pool that `nukak` will use
setQuerierPool(querierPool);
```

&nbsp;

## Define the entities

Take any dump class (aka DTO) and annotate it with the decorators from `nukak/entity`.

```ts
import { v4 as uuidv4 } from 'uuid';
import { Id, Field, Entity } from 'nukak/entity';

@Entity()
export class User {
  @Id({ onInsert: uuidv4 })
  id?: string;
  @Field()
  name?: string;
  @Field()
  email?: string;
  @Field()
  password?: string;
}
```

&nbsp;

## Manipulate the data

```ts
import { getQuerier } from 'nukak';
import { User } from './shared/models/index.js';

async function findLastUsers(limit = 10) {
  const querier = await getQuerier();
  const users = await querier.findMany(User, {
    $project: ['id', 'name', 'email'],
    $sort: { createdAt: -1 },
    $limit: limit,
  });
  await querier.release();
  return users;
}

async function createUser(body: User) {
  const querier = await getQuerier();
  const id = await querier.insertOne(User, body);
  await querier.release();
  return id;
}
```

&nbsp;

Learn more about `nukak` at its website https://nukak.org
