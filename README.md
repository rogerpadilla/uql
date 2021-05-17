[![build status](https://travis-ci.org/impensables/uql.svg?branch=master)](https://travis-ci.org/impensables/uql?branch=master)
[![coverage status](https://coveralls.io/repos/impensables/uql/badge.svg?branch=master)](https://coveralls.io/r/impensables/uql?branch=master)
[![npm version](https://badge.fury.io/js/%40uql%2Fcore.svg)](https://badge.fury.io/js/%40uql%2Fcore)

# `{*}` uql = Universal Query Language

`uql` is a plug & play `ORM`, with a declarative `JSON` syntax to query/update multiple data-sources. Essentially, you just declare what you want from the datasource, and then `uql` will run efficient (and safe) `SQL` (or `Mongo`) queries.

Given `uql` is just a small library with serializable `JSON` syntax, the queries can be written in the client (web/mobile) and send to the backend; or just use `uql` directly in the backend; or even use it in a mobile app with an embedded database.

## <a name="features"></a>:star2: Features

- supports on-demand `populate` (at multiple levels), `projection` of fields/columns (at multiple levels), complex `filtering` (at multiple levels), `sorting`, `pagination`, and more.
- declarative and programmatic `transactions`
- entity `repositories`
- different `relations` between the entities
- supports `inheritance` patterns between the entities
- connection pooling
- supports Postgres, MySQL, MariaDB, SQLite, MongoDB (more coming)
- code is performant, readable, and flexible
- plugins for frameworks: express (more coming)

## Table of Contents

1. [Installation](#installation)
2. [Configuration](#configuration)
3. [Entities](#entities)
4. [Declarative Transactions](#declarative-transactions)
5. [Programmatic Transactions](#programmatic-transactions)
6. [Generate REST APIs from Express](#express)
7. [Consume REST APIs from Frontend](#client)
8. [FAQs](#faq)

## <a name="installation"></a>:battery: Installation

1.  Install the core package:

    ```sh
    npm install @uql/core --save
    ```

    or

    ```sh
    yarn add @uql/core
    ```

2.  Install one of database packages according to your database:

    - for MySQL (or MariaDB)

      ```sh
      npm install @uql/mysql --save
      ```

      or with _yarn_

      ```sh
      yarn add @uql/mysql
      ```

    - for PostgreSQL

      ```sh
      npm install @uql/postgres --save
      ```

      or with _yarn_

      ```sh
      yarn add @uql/postgres
      ```

    - for SQLite

      ```sh
      npm install @uql/sqlite --save
      ```

      or with _yarn_

      ```sh
      yarn add @uql/sqlite
      ```

    - for MongoDB

      ```sh
      npm install @uql/mongo --save
      ```

      or with _yarn_

      ```sh
      yarn add @uql/mongo
      ```

3.  Your `tsconfig.json` needs the following flags:

```json
"target": "es6", // or a more recent ecmascript version
"experimentalDecorators": true,
"emitDecoratorMetadata": true
```

## <a name="configuration"></a>:gear: Configuration

`uql` initialization should be done once (e.g. in one of the bootstrap files of your app).

```ts
import { setOptions } from '@uql/core';
import { PgQuerierPool } from '@uql/postgres';

setOptions({
  querierPool: new PgQuerierPool({
    host: 'localhost',
    user: 'theUser',
    password: 'thePassword',
    database: 'theDatabase',
  }),
  logger: console.log,
  debug: true,
});
```

## <a name="entities"></a>:egg: Entities

Take any dump class (aka DTO) and annotate it with the decorators from '@uql/core/entity/decorator'.

Note: inheritance between entities is optional.

```ts
import { v4 as uuidv4 } from 'uuid';
import { Id, Property, OneToMany, OneToOne, ManyToOne, Entity } from '@uql/core/entity/decorator';

/**
 * an abstract class can optionally be used as a template for the entities
 * (so boilerplate code is reduced)
 */
export abstract class BaseEntity {
  @Id({ onInsert: () => uuidv4() })
  id?: string;

  /**
   * 'onInsert' callback can be used to specify a custom mechanism for
   * obtaining the value of a property when inserting:
   */
  @Property({ onInsert: () => Date.now() })
  createdAt?: number;

  /**
   * 'onUpdate' callback can be used to specify a custom mechanism for
   * obtaining the value of a property when updating:
   */
  @Property({ onUpdate: () => Date.now() })
  updatedAt?: number;

  @Property()
  status?: number;
}

@Entity()
export class Company extends BaseEntity {
  @Property()
  name?: string;

  @Property()
  description?: string;
}

/**
 * a custom name can be specified for the corresponding table/document
 */
@Entity({ name: 'user_profile' })
export class Profile extends BaseEntity {
  /**
   * a custom name can be optionally specified for every property (this also overrides parent's class ID declaration)
   */
  @Id({ name: 'pk' })
  id?: string;

  @Property({ name: 'image' })
  picture?: string;
}

@Entity()
export class User extends BaseEntity {
  @Property()
  name?: string;

  @Property()
  email?: string;

  @Property()
  password?: string;

  @OneToOne({ mappedBy: 'user' })
  profile?: Profile;
}

@Entity()
export class TaxCategory extends BaseEntity {
  /**
   * Any entity can specify its own ID Property and still inherit the others
   * columns/relations from its parent entity.
   * 'onInsert' callback can be used to specify a custom mechanism for
   * auto-generating the primary-key's value when inserting
   */
  @Id({ onInsert: () => uuidv4() })
  pk?: string;

  @Property()
  name?: string;

  @Property()
  description?: string;
}

@Entity()
export class Tax extends BaseEntity {
  @Property()
  name?: string;

  @Property()
  percentage?: number;

  @ManyToOne()
  category?: TaxCategory;

  @Property()
  description?: string;
}
```

## <a name="declarative-transactions"></a>:speaking_head: Declarative Transactions

`uql` supports both, _declarative_ and _programmatic_ transactions, with the former you can just describe the scope of your transactions, with the later you have more flexibility (hence more responsibility).

1. take any service class, annotate the wanted function with the `Transactional()` decorator.
2. inject the querier instance by decorating one of the function's arguments with `@InjectQuerier()`.

```ts
import { Querier } from '@uql/core/type';
import { Transactional, InjectQuerier } from '@uql/core/querier/decorator';

class ConfirmationService {
  @Transactional()
  async confirmAction(body: Confirmation, @InjectQuerier() querier?: Querier) {
    if (body.type === 'register') {
      await querier.insertOne(User, {
        name: body.name,
        email: body.email,
        password: body.password,
      });
    } else {
      await querier.updateOneById(User, body.userId, { password: body.password });
    }
    await querier.updateOneById(Confirmation, body.id, { status: CONFIRM_STATUS_VERIFIED });
  }
}

export const confirmationService = new ConfirmationService();

// then you could just import the constant `confirmationService` in another file,
// and when you call `confirmAction` function, all the operations there
// will (automatically) be run inside a single transaction
await confirmationService.confirmAction(data);
```

## <a name="programmatic-transactions"></a>:hammer_and_wrench: Programmatic Transactions

`uql` supports both, _declarative_ and _programmatic_ transactions, with the former you can just describe the scope of your transactions, with the later you have more flexibility (hence more responsibility).

1. obtain the `querier` object with `await getQuerier()`
2. open a `try/catch/finally` block
3. start the transaction with `await querier.beginTransaction()`
4. perform the different operations using the `querier` or `repositories`
5. commit the transaction with `await querier.commitTransaction()`
6. in the `catch` block, add `await querier.rollbackTransaction()`
7. release the `querier` back to the pool with `await querier.release()` in the `finally` block.

```ts
import { getQuerier } from '@uql/core';

async function confirmAction(body: Confirmation) {
  const querier = await getQuerier();

  try {
    await querier.beginTransaction();

    if (body.action === 'signup') {
      // signup
      await querier.insertOne(User, {
        name: body.name,
        email: body.email,
        password: body.password,
      });
    } else {
      // change password
      await querier.updateOneById(User, body.userId, { password: body.password });
    }

    await querier.updateOneById(Confirmation, body.id, { status: CONFIRM_STATUS_VERIFIED });

    await querier.commitTransaction();
  } catch (error) {
    await querier.rollbackTransaction();
    throw error;
  } finally {
    await querier.release();
  }
}
```

## <a name="express"></a>:zap: Generate REST APIs from Express

`uql` provides a [express](https://expressjs.com/) plugin to automatically generate REST APIs for your entities.

1. Install express plugin in your server project:

```sh
npm install @uql/express --save

```

or with _yarn_

```sh
yarn add @uql/express
```

2. Initialize the `express` middleware in your server code to generate CRUD REST APIs for your entities

```ts
import * as express from 'express';
import { entitiesMiddleware } from '@uql/express';

const app = express();

app
  // ...
  .use(
    '/api',
    // this will generate CRUD REST APIs for the entities.
    entitiesMiddleware({
      // all entities will be automatically exposed unless
      // 'include' or 'exclude' options are provided
      exclude: [Confirmation],
    })
  );
```

## <a name="client"></a>:globe_with_meridians: Consume REST APIs from Frontend

uql provides a client plugin to consume the REST APIs from the frontend.

1. Install client plugin in your frontend project:

```sh
npm install @uql/client --save
```

or with _yarn_

```sh
yarn add @uql/client
```

2. Use the client to call the `uql` CRUD API

```ts
import { getRepository } from '@uql/client';

// 'Item' is an entity class
const querier = await getRepository(Item);

const lastItems = await itemRepository.findMany({
  sort: { createdAt: -1 },
  limit: 100,
});
```

## <a name="faq"></a>:book: Frequently Asked Questions

### Why uql if there already are GraphQL, TypeORM, Mikro-ORM, Sequelize?

GraphQL requires [additional servers](https://graphql.org/learn/execution) and also learning [a new language](https://graphql.org/learn/queries); uql should allow same this, but without need to configure and maintaining additional components.

On the other hand, existing ORMs like TypeORM, Mikro-ORM, and Sequelize; are in one way or another, coupled to databases; uql uses a declarative JSON syntax (agnostic from the datasource) which can easily be serialized and send as messages (e.g. through the network) between different components of a system (e.g. micro-services), and then each one has the flexibility to decide how to process these messages.

At last but not at least, uql helps with the communication between the different tiers of your system, e.g. it allows the frontend to send dynamic requests to the backend (like GraphQL).
