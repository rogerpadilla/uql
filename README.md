[![build status](https://travis-ci.org/impensables/uql.svg?branch=master)](https://travis-ci.org/impensables/uql?branch=master)
[![coverage status](https://coveralls.io/repos/impensables/uql/badge.svg?branch=master)](https://coveralls.io/r/impensables/uql?branch=master)
[![npm version](https://badge.fury.io/js/uql.svg)](https://badge.fury.io/js/uql)

# `{*}` uql = Universal Query Language

uql is a plug & play ORM, with a declarative JSON syntax to query/update different data-sources. Basically, just declare what you want from your datasource, and then uql runs efficient (and safe) SQL or Mongo queries.

## Table of Contents

1. [Features](#features)
2. [Installation](#installation)
3. [Entities](#entities)
4. [Configuration](#configuration)
5. [Declarative Transactions](#declarative-transactions)
6. [Programmatic Transactions](#programmatic-transactions)
7. [Generate REST APIs from Express](#express)
8. [Consume REST APIs from Frontend](#frontend)
9. [FAQs](#faq)

## <a name="features"></a>:star2: Features

- supports on-demand `populate` (at multiple levels), `projection` of fields/columns (at multiple levels), complex `filtering` (at multiple levels), `grouping`,
  and `pagination`.
- declarative and imperative `transactions`
- generic and custom `repositories`
- `relations` between entities
- supports entities `inheritance` patterns
- connection pooling
- supports Postgres, MySQL, MariaDB, MongoDB, SQLite
- code is readable, short, performant and flexible
- plugins for frameworks: express, more soon...

## <a name="installation"></a>:battery: Installation

1. Install the npm package:

   `npm install uql --save` or `yarn add uql`

2. Make sure to enable the following properties in the `tsconfig.json` file of your `TypeScript` project: `experimentalDecorators` and `emitDecoratorMetadata`

3. Install a database driver according to your database:

   - for MySQL or MariaDB

     `npm install mysql2 --save` (alternatively, `mysql` or `mariadb` driver can be used)

   - for PostgreSQL or CockroachDB

     `npm install pg --save`

   - for MongoDB

     `npm install mongodb --save`

   - for SQLite :construction:

     `npm install sqlite3 --save`

## <a name="entities"></a>:egg: Entities

Notice that the inheritance between entities is optional

```typescript
import { v4 as uuidv4 } from 'uuid';
import { Column, ManyToOne, Id, OneToMany, Entity, OneToOne } from 'uql/entity';

/**
 * an abstract class can (optionally) be used as a template for the entities
 * (so boilerplate code is reduced)
 */
export abstract class BaseEntity {
  @Id()
  id?: string;
  /**
   * different relations between entities are supported
   */
  @ManyToOne({ type: () => Company })
  company?: string | Company;
  @ManyToOne({ type: () => User })
  user?: string | User;
  /**
   * 'onInsert' callback can be used to specify a custom mechanism for
   * obtaining the value of a column when inserting:
   */
  @Column({ onInsert: () => Date.now() })
  createdAt?: string;
  /**
   * 'onUpdate' callback can be used to specify a custom mechanism for
   * obtaining the value of a column when updating:
   */
  @Column({ onUpdate: () => Date.now() })
  updatedAt?: string;
  @Column()
  status?: string;
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
   * a custom name can be (optionally) specified for every column
   */
  @Id({ name: 'pk' })
  id?: string;
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
  @Id({ onInsert: () => uuidv4() })
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
import { initUql } from 'uql';
import { GenericServerRepository } from 'uql/repository';

initUql({
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

## <a name="declarative-transactions"></a>:speaking_head: Declarative Transactions

```typescript
import { Transactional, InjectQuerier, Querier } from 'uql/datasource';
import { getServerRepository } from 'uql/repository';

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
      const userId = body.user as string;
      await userRepository.updateOneById(userId, { password: body.password }, querier);
    }

    await confirmationRepository.updateOneById(body.id, { status: CONFIRM_STATUS_VERIFIED }, querier);
  }
}
```

## <a name="programmatic-transactions"></a>:hammer_and_wrench: Programmatic Transactions

```typescript
import { getQuerier } from 'uql/datasource/querierPool';

// ...then inside any of your functions

const querier = getQuerier();

try {
  // start a transaction
  await querier.beginTransaction();

  // create one user
  const generatedId: string = await querier.insertOne(User, {
    name: 'Some Name',
    email1: { picture: 'abc1@example.com' },
    profile: { picture: 'abc1' },
  });

  // create multiple users in a batch
  const generatedIds: string[] = await querier.insert(User, [
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

## <a name="express"></a>:zap: Generate REST APIs from Express

uql provides a [express](https://expressjs.com/) plugin to automatically generate REST APIs for your entities.

1. Install express plugin in your server project `npm install uql-express --save` or `yarn add uql-express`
2. Initialize the express middleware in your server code to generate CRUD REST APIs for your entities

```typescript
import { entitiesMiddleware } from 'uql-express';

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

## <a name="frontend"></a>:globe_with_meridians: Consume REST APIs from Frontend

uql provides a browser plugin to consume the REST APIs.

1. Install browser plugin in your frontend project `npm install uql-browser --save` or `yarn add uql-browser`
2. Initialize uql in your frontend code

```typescript
import { GenericClientRepository, initUql } from 'uql-browser';

initUql({
  defaultRepositoryClass: GenericClientRepository,
});

// 'Item' is an entity class
const lastItems = await getClientRepository(Item).find({ sort: { createdAt: -1 }, limit: 100 });
```

## <a name="faq"></a>:book: Frequently Asked Questions

### Why uql when there already are GraphQL, TypeORM, Mikro-ORM, Sequelize?

Because GraphQL requires [additional servers](https://graphql.org/learn/execution) and also [a new language](https://graphql.org/learn/queries); uql should allow same this, but without need to configure and maintain these additional components.

On the other hand, existing ORMs like TypeORM, Mikro-ORM, and Sequelize, do all use an imperative API (call to functions); uql uses a declarative API (JSON) which can be serialized and send as messages (through the network) between the different components of a system.
