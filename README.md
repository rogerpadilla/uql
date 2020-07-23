**WIP**

## onql

<!-- [![build status](https://travis-ci.org/rogerpadilla/onql.svg?branch=master)](https://travis-ci.org/rogerpadilla/onql?branch=master) -->
<!-- [![coverage status](https://coveralls.io/repos/rogerpadilla/onql/badge.svg?branch=master)](https://coveralls.io/r/rogerpadilla/onql?branch=master) -->
<!-- [![dependencies status](https://david-dm.org/rogerpadilla/onql/status.svg)](https://david-dm.org/rogerpadilla/onql/status.svg) -->
<!-- [![dev dependencies status](https://david-dm.org/rogerpadilla/onql/dev-status.svg)](https://david-dm.org/rogerpadilla/onql/dev-status.svg) -->
<!-- [![npm downloads](https://img.shields.io/npm/dm/onql.svg)](https://www.npmjs.com/package/onql) -->
<!-- [![npm version](https://badge.fury.io/js/onql.svg)](https://www.npmjs.com/onql) -->

onql's dream is to achieve what [GraphQL](https://graphql.org/learn) but in a much simpler way; onql's expressible (and type-safe) JSON syntax allows to query/update the data and gives the power to ask for exactly what is necessary and nothing else.

GraphQL already allows to do that, but it requires to configure [additional servers](https://graphql.org/learn/execution) and to learn a [new language](https://graphql.org/learn/queries); in the other hand, onql is a plug & play library, based on JSON syntax, which can be used with (and without) any NodeJs framework (like express, restify, hapi, koa...).

onql's syntax is inspired in MongoDb, JPA, TypeORM and GraphQL. One simply declares the entities (DTOs), add some decorators to them as metadata, and then start using the (type-safe) JSON syntax to send complex (and auto-sanitized) query-expressions from the frontend/client to the backend/server (like GraphQL allows).

Most important features of onql are:

- supports on-demand `populate` (at multiple levels), `projection` of fields/columns (at multiple levels), complex `filtering` (at multiple levels), `grouping`,
  and `pagination`.
- declarative and imperative `transactions`
- generic and custom `repositories`
- `relations` between entities
- supports `inheritance` patterns
- connection pooling
- supports Postgres, MySQL, MariaDB, SQLite (WIP), MongoDB (WIP), more soon
- code is readable, performant and flexible

Steps to use:

- Declare the entities (notice inheritance is optional)

```typescript
export abstract class BaseEntity {
  @IdColumn()
  id?: number;
  @ManyToOne({ type: () => Company })
  company?: number | Company;
  @ManyToOne({ type: () => User })
  user?: number | User;
  @Column({ onInsert: () => Date.now() })
  createdAt?: number;
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

@Entity({ name: 'user_profile' })
export class Profile extends BaseEntity {
  @IdColumn({ name: 'pk' })
  id?: number;
  @Column({ name: 'image' })
  picture?: string;
}

@Entity({ name: 'user' })
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

- initialize `onql` configuration:

```typescript
import { initOnql } from 'onql';
import { GenericServerRepository } from 'onql/repository';
// `pg` is for postgres driver, other databases are supported.
initOnql({ datasource: { driver: 'pg' }, defaultRepositoryClass: GenericServerRepository });
```

- your logic will look like this:

```typescript
try {
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

## Installation

1. Install the npm package:

   `npm install onql --save` or `yarn add onql`

2. You need to install `reflect-metadata` shim:

   `npm install reflect-metadata --save` or `yarn add reflect-metadata`

   and import it somewhere in the global place of your app (for example in `app.ts`):

   `import 'reflect-metadata';`

3. Make sure to enable the following properties in the `tsconfig.json` file of your `TypeScript` project: `experimentalDecorators` and `emitDecoratorMetadata`

4. Install a database driver (pick the one you need for your database):

   - for MySQL or MariaDB

     `npm install mysql2 --save` (possible to install `mysql` or `mariadb` instead as well)

   - for PostgreSQL or CockroachDB

     `npm install pg --save`

   - for SQLite (experimental)

     `npm install sqlite3 --save`

   - for MongoDB (experimental)

     `npm install mongodb --save`
