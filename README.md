# [uql](https://uql.io) &middot; [![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/impensables/uql/blob/master/LICENSE) [![tests](https://github.com/impensables/uql/actions/workflows/tests.yml/badge.svg)](https://github.com/impensables/uql) [![coverage status](https://coveralls.io/repos/impensables/uql/badge.svg?branch=master)](https://coveralls.io/r/impensables/uql?branch=master) [![npm version](https://badge.fury.io/js/%40uql%2Fcore.svg)](https://badge.fury.io/js/%40uql%2Fcore)

[Learn how to use uql in your own project](https://uql.io).

# Getting Started

`uql` is a flexible and efficient `ORM`, with declarative `JSON` syntax and smart type-safety.

Given it is just a small library with serializable `JSON` syntax, the queries can be written in the client (web/mobile) and send to the backend, or just use `uql` directly in the backend, or even use it in a mobile app with an embedded database.

![autocomplete demo](https://uql.io/code.gif)

## <a name="features"></a> Features

- `JSON` (serializable) syntax for all the queries.
- uses the power of `TypeScript` to get (smart) type-safety everywhere.
- the generated queries are performant, safe, and human-readable.
- `$project`, `$filter`, `$sort`, `$limit` works at multiple levels (including deep relations and their fields).
- declarative and imperative `transactions`.
- `soft-delete`, `virtual fields`, `repositories`, `connection pooling`.
- different kinds of `relations` between entities.
- transparent support for `inheritance` patterns between entities.
- supports `Postgres`, `MySQL`, `MariaDB`, `SQLite`, `MongoDB` (beta).
- plugins for frameworks: `express` (more coming).

## Table of Contents

1. [Installation](#installation)
2. [Configuration](#configuration)
3. [Entities](#entities)
4. [Declarative Transactions](#declarative-transactions)
5. [Imperative Transactions](#imperative-transactions)
6. [Generate REST APIs with Express](#express)
7. [Consume REST APIs from the Frontend](#client)
8. [FAQs](#faq)

## <a name="installation"></a> Installation

1. Install the core package:

   ```sh
   npm install @uql/core --save
   ```

   or

   ```sh
   yarn add @uql/core
   ```

1. Install one of the following packages according to your database:

| Database     | Package         |
| ------------ | --------------- |
| `MySQL`      | `@uql/mysql`    |
| `MariaDB`    | `@uql/maria`    |
| `PostgreSQL` | `@uql/postgres` |
| `SQLite`     | `@uql/sqlite`   |
| `MongoDB`    | `@uql/mongo`    |

E.g. for `PostgreSQL`

```sh
npm install @uql/postgres --save
```

or with _yarn_

```sh
yarn add @uql/postgres
```

1. Additionally, your `tsconfig.json` needs the following flags:

```json
"target": "es6", // or a more recent ecmascript version.
"experimentalDecorators": true,
"emitDecoratorMetadata": true
```

## <a name="configuration"></a> Configuration

Initialization should be done once (e.g. in one of the bootstrap files of your app).

```ts
import { setOptions } from '@uql/core';
import { PgQuerierPool } from '@uql/postgres';

setOptions({
  querierPool: new PgQuerierPool(
    {
      host: 'localhost',
      user: 'theUser',
      password: 'thePassword',
      database: 'theDatabase',
    },
    console.log
  ),
});
```

## <a name="entities"></a> Entities

Take any dump class (aka DTO) and annotate it with the decorators from `'@uql/core/entity'`.

```ts
import { Field, ManyToOne, Id, OneToMany, Entity, OneToOne, ManyToMany } from '@uql/core/entity';

@Entity()
export class Profile {
  /**
   * primary key
   */
  @Id()
  id?: number;
  @Field()
  picture?: string;
  /**
   * foreign-keys are really simple to specify.
   */
  @Field({ reference: () => User })
  creatorId?: number;
}

@Entity()
export class User {
  @Id()
  id?: number;
  @Field()
  name?: string;
  @Field()
  email?: string;
  @Field()
  password?: string;
  /**
   * `mappedBy` can be a callback or a string (callback is useful for auto-refactoring).
   */
  @OneToOne({ entity: () => Profile, mappedBy: (profile) => profile.creatorId, cascade: true })
  profile?: Profile;
}

@Entity()
export class MeasureUnitCategory {
  @Id()
  id?: number;
  @Field()
  name?: string;
  @OneToMany({ entity: () => MeasureUnit, mappedBy: (measureUnit) => measureUnit.category })
  measureUnits?: MeasureUnit[];
}

@Entity()
export class MeasureUnit {
  @Id()
  id?: number;
  @Field()
  name?: string;
  @Field({ reference: () => MeasureUnitCategory })
  categoryId?: number;
  @ManyToOne({ cascade: 'persist' })
  category?: MeasureUnitCategory;
}

@Entity()
export class Item {
  @Id()
  id?: number;
  @Field()
  name?: string;
  @Field()
  description?: string;
  @Field()
  code?: string;
  @ManyToMany({ entity: () => Tag, through: () => ItemTag, cascade: true })
  tags?: Tag[];
}

@Entity()
export class Tag {
  @Id()
  id?: number;
  @Field()
  name?: string;
  @ManyToMany({ entity: () => Item, mappedBy: (item) => item.tags })
  items?: Item[];
}

@Entity()
export class ItemTag {
  @Id()
  id?: number;
  @Field({ reference: () => Item })
  itemId?: number;
  @Field({ reference: () => Tag })
  tagId?: number;
}
```

## <a name="declarative-transactions"></a> Declarative Transactions

Both, _declarative_ and _imperative_ transactions are supported, with the former you can just describe the scope of your transactions, with the later you have more flexibility (hence more responsibility).

To use Declarative Transactions (using the `@Transactional` decorator):

1. take any service class, annotate the wanted function with the `@Transactional` decorator.
2. inject the querier instance by decorating one of the function's arguments with `@InjectQuerier`.

```ts
import { Querier } from '@uql/core/type';
import { Transactional, InjectQuerier } from '@uql/core/querier';

class ConfirmationService {
  @Transactional()
  async confirm(confirmation: Confirmation, @InjectQuerier() querier?: Querier): Promise<void> {
    if (confirmation.type === 'register') {
      await querier.insertOne(User, {
        name: confirmation.name,
        email: confirmation.email,
        password: confirmation.password,
      });
    } else {
      await querier.updateOneById(User, confirmation.creatorId, {
        password: confirmation.password,
      });
    }
    await querier.updateOneById(Confirmation, confirmation.id, { status: 1 });
  }
}

export const confirmationService = new ConfirmationService();

/**
 * then you could just import the constant `confirmationService` in another file,
 * and when you call `confirmAction` function, all the operations there
 * will (automatically) run inside a single transaction.
 */
await confirmationService.confirmAction(data);
```

## <a name="imperative-transactions"></a> Imperative Transactions

`uql` supports both, _declarative_ and _imperative_ transactions, with the former you can just describe the scope of your transactions, with the later you have more flexibility (hence more responsibility).

To use Imperative Transactions:

1. obtain the `querier` object with `await getQuerier()`.
2. run the transaction with `await querier.transaction(callback)`.
3. perform the different operations using the same `querier` (or `repositories`) inside your `callback` function.

```ts
import { getQuerier } from '@uql/core';

async function confirm(confirmation: Confirmation): Promise<void> {
  const querier = await getQuerier();
  await querier.transaction(async () => {
    if (confirmation.action === 'signup') {
      await querier.insertOne(User, {
        name: confirmation.name,
        email: confirmation.email,
        password: confirmation.password,
      });
    } else {
      await querier.updateOneById(User, confirmation.creatorId, {
        password: confirmation.password,
      });
    }
    await querier.updateOneById(Confirmation, confirmation.id, { status: 1 });
  });
}
```

---

That &#9650; can also be implemented as this &#9660; (for more granular control):

```ts
async function confirm(confirmation: Confirmation): Promise<void> {
  const querier = await getQuerier();
  try {
    await querier.beginTransaction();
    if (confirmation.action === 'signup') {
      await querier.insertOne(User, {
        name: confirmation.name,
        email: confirmation.email,
        password: confirmation.password,
      });
    } else {
      await querier.updateOneById(User, confirmation.creatorId, {
        password: confirmation.password,
      });
    }
    await querier.updateOneById(Confirmation, confirmation.id, { status: 1 });
    await querier.commitTransaction();
  } catch (error) {
    await querier.rollbackTransaction();
    throw error;
  } finally {
    await querier.release();
  }
}
```

## <a name="express"></a> Autogenerate REST APIs with Express

A `express` plugin is provided to automatically generate REST APIs for your entities.

1. Install express plugin in your server project:

```sh
npm install @uql/express --save
```

or with _yarn_

```sh
yarn add @uql/express
```

1. Initialize the `express` middleware in your server code to generate REST APIs for your entities

```ts
import * as express from 'express';
import { augmentFilter } from '@uql/core/util';
import { Query, EntityMeta } from '@uql/core/type';
import { querierMiddleware } from '@uql/express';

const app = express();

app
  // ...
  .use(
    '/api',

    // this will generate REST APIs for the entities.
    querierMiddleware({
      // all entities will be automatically exposed unless
      // 'include' or 'exclude' options are provided.
      exclude: [Confirmation],

      // `augmentQuery` callback allows to extend all then queries that are requested to the API,
      // so it is a good place to add additional filters to the queries,
      // e.g. for multi tenant apps.
      augmentQuery: <E>(meta: EntityMeta<E>, qm: Query<E>, req: express.Request): Query<E> => {
        // ensure the user can only see the data that belongs to the related company.
        qm.$filter = augmentFilter(qm.$filter, { companyId: req.identity.companyId });
        return qm;
      },
    })
  );
```

## <a name="client"></a> Easily call the generated REST APIs from the Client

A client plugin (for browser/mobile) is provided to easily consume the REST APIs from the frontend.

1. Install client plugin in your frontend project:

```sh
npm install @uql/client --save
```

or with _yarn_

```sh
yarn add @uql/client
```

1. Use the client to call the `uql` CRUD API

```ts
import { getRepository } from '@uql/client';

// 'User' is an entity class.
const userRepository = getRepository(User);

const users = await userRepository.findMany({
  $project: { email: true, profile: ['picture'] },
  $filter: { email: { $endsWith: '@domain.com' } },
  $sort: { createdAt: -1 },
  $limit: 100,
});
```
