[![build status](https://travis-ci.org/onql/onql.svg?branch=master)](https://travis-ci.org/rogerpadilla/onql?branch=master)
[![coverage status](https://coveralls.io/repos/onql/onql/badge.svg?branch=master)](https://coveralls.io/r/onql/onql?branch=master)
[![dependencies status](https://david-dm.org/onql/onql/status.svg)](https://david-dm.org/rogerpadilla/onql/status.svg)
[![dev dependencies status](https://david-dm.org/onql/onql/dev-status.svg)](https://david-dm.org/onql/onql/dev-status.svg)
[![npm version](https://badge.fury.io/js/%40onql%2Fcore.svg)](https://badge.fury.io/js/%40onql%2Fcore)

# `{*}` onql

onql is a plug & play ORM library, with a declarative (and type-safe) JSON syntax allowing to query/update different data-sources. Basically, you declare what you want (using JSON) from your database, and then onql runs efficient (and safe) SQL or Mongo queries.

onql's dream is to achieve what [GraphQL](https://graphql.org/learn) achieves (expressive syntax to retrieve what is necessary), but in a simple way (no need for [additional servers](https://graphql.org/learn/execution) nor [a new language](https://graphql.org/learn/queries)). onql can be used with (and without) any backend/frontend framework. onql's syntax is inspired by MongoDb, JPA, and GraphQL.

## Table of Contents

1. [Features](#features)
2. [Installation](#installation)
3. [Entities definition](#entities-definition)
4. [Configuration](#configuration)
5. [Declarative API](#declarative-api)
6. [Programmatic API](#programmatic-api)
7. [Generate CRUD REST APIs and call from Browser](#generate-crud-rest-api)
8. [Frequently Asked Questions](#faq)

## <a name="features"></a>:star2: Features

- supports on-demand `populate` (at multiple levels), `projection` of fields/columns (at multiple levels), complex `filtering` (at multiple levels), `grouping`,
  and `pagination`.
- declarative and imperative `transactions`
- generic and custom `repositories`
- `relations` between entities
- supports `inheritance` patterns
- connection pooling
- supports Postgres, MySQL, MariaDB, SQLite :construction:, MongoDB :construction:, more soon...
- code is readable, short, performant and flexible
- plugins form frameworks: express, more soon...

## <a name="installation"></a>:battery: Installation

1. Install the npm package:

   `npm install @onql/core --save` or `yarn add @onql/core`

2. Make sure to enable the following properties in the `tsconfig.json` file of your `TypeScript` project: `experimentalDecorators` and `emitDecoratorMetadata`

3. Install a database driver according to your database:

   - for MySQL or MariaDB

     `npm install mysql2 --save` (alternatively, `mysql` or `mariadb` driver can be used)

   - for PostgreSQL or CockroachDB

     `npm install pg --save`

   - for SQLite :construction:

     `npm install sqlite3 --save`

   - for MongoDB :construction:

     `npm install mongodb --save`

## <a name="entities-definition"></a>:egg: Entities definition

Notice that the inheritance between entities is optional

```typescript
import { v4 as uuidv4 } from 'uuid';
import { Column, ManyToOne, IdColumn, OneToMany, Entity, OneToOne } from '@onql/core/entity';

/**
 * an abstract class can (optionally) be used as a template for the entities
 * (so boilerplate code is reduced)
 */
export abstract class BaseEntity {
  @IdColumn()
  id?: number;
  /**
   * different relations between entities are supported
   */
  @ManyToOne({ type: () => Company })
  company?: number | Company;
  @ManyToOne({ type: () => User })
  user?: number | User;
  /**
   * 'onInsert' callback can be used to specify a custom mechanism for
   * obtaining the value of a column when inserting:
   */
  @Column({ onInsert: () => Date.now() })
  createdAt?: number;
  /**
   * 'onUpdate' callback can be used to specify a custom mechanism for
   * obtaining the value of a column when updating:
   */
  @Column({ onUpdate: () => Date.now() })
  updatedAt?: number;
  @Column()
  status?: number;
}

@Entity()
export class Company extends BaseEntity {
  @Column()
  name?: string;
  @Column()
  description?: string;
}

/**
 * a custom name can be specified for the corresponding table/document
 */
@Entity({ name: 'user_profile' })
export class Profile extends BaseEntity {
  /**
   * a custom name can be specified for the corresponding column
   */
  @IdColumn({ name: 'pk' })
  id?: number;
  @Column({ name: 'image' })
  picture?: string;
}

@Entity()
export class User extends BaseEntity {
  @Column()
  name?: string;
  @Column()
  email?: string;
  @Column()
  password?: string;
  @OneToOne({ mappedBy: 'user' })
  @Column()
  profile?: Profile;
}

@Entity()
export class TaxCategory extends BaseEntity {
  /**
   * Any entity can specify its own ID Column and still inherit the others
   * columns/relations from its parent entity.
   * 'onInsert' callback can be used to specify a custom mechanism for
   * auto-generating the primary-key's value when inserting
   */
  @IdColumn({ onInsert: () => uuidv4() })
  pk?: string;
  @Column()
  name?: string;
  @Column()
  description?: string;
}

@Entity()
export class Tax extends BaseEntity {
  @Column()
  name?: string;
  @Column()
  percentage?: number;
  @ManyToOne()
  @Column()
  category?: TaxCategory;
  @Column()
  description?: string;
}
```

## <a name="configuration"></a>:gear: Configuration

```typescript
import { initOnql } from '@onql/core';
import { GenericServerRepository } from '@onql/core/repository';

initOnql({
  datasource: {
    driver: 'pg',
    host: 'localhost',
    user: 'theUser',
    password: 'thePassword',
    database: 'theDatabaseName',
  },
  defaultRepositoryClass: GenericServerRepository,
});
```

## <a name="declarative-api"></a>:mechanical_arm: Declarative API

```typescript
import { Transactional, InjectQuerier, Querier } from '@onql/core/datasource';
import { getServerRepository } from '@onql/core/repository';

export class ConfirmationService {
  
  @Transactional()
  async confirmAction(body: Confirmation, @InjectQuerier() querier?: Querier): Promise<void> {
    const userRepository = getServerRepository(User);
    const confirmationRepository = getServerRepository(User);

    if (body.type === 'register') {
      const newUser: User = {
        name: body.name,
        email: body.email,
        password: body.password,
      };
      await userRepository.insertOne(newUser, querier);
    } else {
      const userId = body.user as number;
      await userRepository.updateOneById(userId, { password: body.password }, querier);
    }

    await confirmationRepository.updateOneById(body.id, { status: CONFIRM_STATUS_VERIFIED }, querier);
  }
}
```

## <a name="programmatic-api"></a>:hammer_and_wrench: Programmatic API

```typescript
import { getQuerier } from '@onql/core/datasource/querierPool';

// ...then inside any of your functions

const querier = getQuerier();

try {
  // start a transaction
  await querier.beginTransaction();

  // create one user
  const generatedId: number = await querier.insertOne(User, {
    name: 'Some Name',
    email1: { picture: 'abc1@example.com' },
    profile: { picture: 'abc1' },
  });

  // create multiple users in a batch
  const generatedIds: number[] = await querier.insert(User, [
    {
      name: 'Another Name',
      email: { picture: 'abc2@example.com' },
      profile: { picture: 'abc2' },
      company: 123,
    },
    {
      name: 'One More Name',
      email: { picture: 'abc3@example.com' },
      profile: { picture: 'abc3' },
      company: 123,
    },
  ]);

  // find users
  const users: User[] = await querier.find(User, {
    populate: { profile: null }, // retrieve all fields for 'profile'
    filter: { company: 123 },
    limit: 100,
  });

  // update users
  const updatedRows: number = await querier.updateOneById(User, generatedId, { company: 123 });

  // removed users
  const updatedRows: number = await querier.removeOneById(User, generatedId);

  // count users
  const count: number = await querier.count(User, { company: 3 });

  await querier.commit();
} catch (error) {
  await querier.rollback();
} finally {
  await querier.release();
}
```

## <a name="generate-crud-rest-api"></a>:zap: Expose CRUD REST APIs and consume it from Browser

onql do provides a [express](https://expressjs.com/) (more soon) plugin to easily generate CRUD REST APIs for your entities.

1. Install express plugin in your server project `npm install @onql/platform-express --save` or `yarn add @onql/platform-express`
2. Initialize the express middleware in your server code to generate CRUD REST APIs for your entities

```typescript
import { entitiesMiddleware } from '@onql/platform-express';

const app = express();

app
  // ...other routes may go before and/or after (as usual)
  .use(
    '/api',
    // this will generate CRUD REST APIs for the entities.
    // all entities will be automatically exposed unless
    // 'include' or 'exclude' options are provided
    entitiesMiddleware({      
      exclude: [Confirmation, User],
    })
  );
```

3. Install browser plugin in your frontend project `npm install @onql/platform-browser --save` or `yarn add @onql/platform-browser`
4. Initialize onql in your frontend code

```typescript
import { GenericClientRepository, initOnql } from '@onql/platform-browser';

initOnql({
  defaultRepositoryClass: GenericClientRepository,
});

const lastItems = await getClientRepository(Item).find({ sort: { createdAt: -1 }, limit: 100 });
```

## <a name="faq"></a>:book: Frequently Asked Questions

### Why onql when there already are GraphQL, TypeORM, Mikro-ORM, Sequelize?

Because GraphQL requires [additional servers](https://graphql.org/learn/execution) and also [a new language](https://graphql.org/learn/queries); onql should allow same this, but without need to configure and maintain these additional components.

On the other hand, existing ORMs like TypeORM, Mikro-ORM, and Sequelize, do all use an imperative API (call to functions); onql uses a declarative API (JSON) which can be serialized and send as messages (through the network) between the different components of a system.
