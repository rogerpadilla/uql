[![build status](https://travis-ci.org/impensables/uql.svg?branch=master)](https://travis-ci.org/impensables/uql?branch=master)
[![coverage status](https://coveralls.io/repos/impensables/uql/badge.svg?branch=master)](https://coveralls.io/r/impensables/uql?branch=master)
[![npm version](https://badge.fury.io/js/%40uql%2Fcore.svg)](https://badge.fury.io/js/%40uql%2Fcore)

# `{*}` uql = Universal Query Language

uql is a plug & play ORM, with a declarative `JSON` syntax to query/update different data-sources. Basically, just declare what you want from your datasource, and then uql will run efficient (and safe) SQL (or Mongo) queries.

Given uql is just a library/parser, its queries can be written and sent from the web/mobile to the backend, or use directly in the backend, or even use in the mobile with an embedded database.

## Table of Contents

1. [Features](#features)
2. [Installation](#installation)
3. [Entities](#entities)
4. [Configuration](#configuration)
5. [Programmatic Transactions](#programmatic-transactions)
6. [Declarative Transactions](#declarative-transactions)
7. [Generate REST APIs from Express](#express)
8. [Consume REST APIs from Frontend](#client)
9. [FAQs](#faq)

## <a name="features"></a>:star2: Features

- supports on-demand `populate` (at multiple levels), `projection` of fields/columns (at multiple levels), complex `filtering` (at multiple levels), `grouping`,
  and `pagination`.
- programmatic and declarative `transactions`
- generic and custom `repositories`
- `relations` between entities
- supports entities `inheritance` patterns
- connection pooling
- supports Postgres, MySQL, MariaDB, SQLite, MongoDB
- code is readable, short, performant and flexible
- plugins for frameworks: express, more soon...

## <a name="installation"></a>:battery: Installation

1. Install the npm package:

   `npm install @uql/core --save` or `yarn add @uql/core`

2. Make sure to enable the following properties in the `tsconfig.json` file: `experimentalDecorators` and `emitDecoratorMetadata`

3. Install a database driver according to your database:

   - for MySQL or MariaDB

     `npm install mysql2 --save` (alternatively, `mariadb` driver can be used)

   - for PostgreSQL or CockroachDB

     `npm install pg --save`

   - for SQLite

     `npm install sqlite3 --save`

   - for MongoDB

     `npm install mongodb --save`

## <a name="entities"></a>:egg: Entities

Take any dump class (DTO) and annotate it with the decorators from package '@uql/core/entity/decorator'.
Notice that the inheritance between entities is optional.

```typescript
import { v4 as uuidv4 } from 'uuid';
import { Id, Property, OneToMany, OneToOne, ManyToOne, Entity } from '@uql/core/entity/decorator';

/**
 * an abstract class can optionally be used as a template for the entities
 * (so boilerplate code is reduced)
 */
export abstract class BaseEntity {
  @Id()
  id?: string;

  /**
   * different relations between entities are supported
   */
  @ManyToOne({ entity: () => Company })
  company?: string | Company;

  @ManyToOne({ entity: () => User })
  user?: string | User;

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

## <a name="configuration"></a>:gear: Configuration

uql's initialization should be done once in a bootstrap file of your code (typically called `server.js`).

```typescript
import { setOptions } from '@uql/core';

setOptions({
  datasource: {
    driver: 'pg',
    host: 'localhost',
    user: 'theUser',
    password: 'thePassword',
    database: 'theDatabase',
  },
  logger: console.log,
  debug: true,
});
```

## <a name="programmatic-transactions"></a>:hammer_and_wrench: Programmatic Transactions

uql supports both, _programmatic_ and _declarative_ transactions, with the former you have more flexibility
(hence more responsibility), with the later you can describe the scope of your transactions.

1. obtain the `querier` object with `await getQuerier()`
2. open a `try/catch/finally` block
3. start the transaction with `await querier.beginTransaction()`
4. perform the different operations using the `querier`
5. commit the transaction with `await querier.commitTransaction()`
6. in the `catch` block, add `await querier.rollbackTransaction()`
7. release the `querier` back to the pool with `await querier.release()` in the `finally` block.

```typescript
import { getQuerier } from '@uql/core/querier';

async function confirmAction(confirmation: Confirmation): Promise<void> {
  const querier = await getQuerier();

  try {
    await querier.beginTransaction();

    if (confirmation.entity === 'register') {
      const newUser: User = {
        name: confirmation.name,
        email: confirmation.email,
        password: confirmation.password,
      };
      await querier.insertOne(User, newUser);
    } else {
      // confirm change password
      const userId = confirmation.user as string;
      await querier.updateOneById(User, userId, { password: confirmation.password });
    }

    await this.querier.updateOneById(Confirmation, body.id, { status: CONFIRM_STATUS_VERIFIED });

    await querier.commitTransaction();
  } catch (error) {
    await querier.rollbackTransaction();
    throw error;
  } finally {
    await querier.release();
  }
}
```

## <a name="declarative-transactions"></a>:speaking_head: Declarative Transactions

uql supports both, _programmatic_ and _declarative_ transactions, with the former you have more flexibility
(hence more responsibility), with the later you can describe the scope of your transactions.

1. take any service class, annotate a property to inject the `querier` with `@InjectQuerier()`
2. add `Transactional()` decorator on the function. Attribute `propagation` (defaults to `required`)
   can be passed to customize its value, e.g. `@Transactional({ propagation: 'supported' })`.

```typescript
import { Querier } from '@uql/core/type';
import { Transactional, InjectQuerier } from '@uql/core/querier/decorator';

class ConfirmationService {
  @InjectQuerier()
  querier: Querier;

  @Transactional()
  async confirmAction(body: Confirmation): Promise<void> {
    if (body.type === 'register') {
      const newUser: User = {
        name: body.name,
        email: body.email,
        password: body.password,
      };
      await this.querier.insertOne(User, newUser);
    } else {
      const userId = body.user as string;
      await this.querier.updateOneById(User, userId, { password: body.password });
    }

    await this.querier.updateOneById(Confirmation, body.id, { status: CONFIRM_STATUS_VERIFIED });
  }
}

export const confirmationService = new ConfirmationService();

// then you can just import the constant `confirmationService` in another file,
// and when you call `confirmationService.confirmAction` all the operations there
// will automatically run inside a single transaction
await confirmationService.confirmAction(data);
```

## <a name="express"></a>:zap: Generate REST APIs from Express

uql provides a [express](https://expressjs.com/) plugin to automatically generate REST APIs for your entities.

1. Install express plugin in your server project `npm install @uql/express --save` or `yarn add @uql/express`
2. Initialize the express middleware in your server code to generate CRUD REST APIs for your entities

```typescript
import * as express from 'express';
import { entitiesMiddleware } from '@uql/express';

const app = express();

app
  // ...other routes may go before and/or after (as usual)
  .use(
    '/api',
    // this will generate CRUD REST APIs for the entities.
    // all entities will be automatically exposed unless
    // 'include' or 'exclude' options are provided
    entitiesMiddleware({
      exclude: [Confirmation],
    })
  );
```

## <a name="client"></a>:globe_with_meridians: Consume REST APIs from Frontend

uql provides a client plugin to consume the REST APIs from the frontend.

1. Install client plugin in your frontend project `npm install @uql/client --save` or `yarn add @uql/client`

```typescript
import { querier } from '@uql/client';

// 'Item' is an entity class
const lastItems = await querier.find(Item, { sort: { createdAt: -1 }, limit: 100 });
```

## <a name="faq"></a>:book: Frequently Asked Questions

### Why uql if there already are GraphQL, TypeORM, Mikro-ORM, Sequelize?

GraphQL requires [additional servers](https://graphql.org/learn/execution) and also learning [a new language](https://graphql.org/learn/queries); uql should allow same this, but without need to configure and maintaining additional components.

On the other hand, existing ORMs like TypeORM, Mikro-ORM, and Sequelize; are in one way or another, coupled to databases; uql uses a declarative JSON syntax (agnostic from the datasource) which can easily be serialized and send as messages (e.g. through the network) between different components of a system (e.g. micro-services), and then each one has the flexibility to decide how to process these messages.

At last but not at least, uql helps with the communication between the different tiers of your system, e.g. it allows the frontend to send dynamic requests to the backend (like GraphQL).
