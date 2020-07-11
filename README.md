**WIP**

## corozo

<!-- [![build status](https://travis-ci.org/rogerpadilla/corozo.svg?branch=master)](https://travis-ci.org/rogerpadilla/corozo?branch=master) -->
<!-- [![coverage status](https://coveralls.io/repos/rogerpadilla/corozo/badge.svg?branch=master)](https://coveralls.io/r/rogerpadilla/corozo?branch=master) -->
<!-- [![dependencies status](https://david-dm.org/rogerpadilla/corozo/status.svg)](https://david-dm.org/rogerpadilla/corozo/status.svg) -->
<!-- [![dev dependencies status](https://david-dm.org/rogerpadilla/corozo/dev-status.svg)](https://david-dm.org/rogerpadilla/corozo/dev-status.svg) -->
<!-- [![npm downloads](https://img.shields.io/npm/dm/corozo.svg)](https://www.npmjs.com/package/corozo) -->
<!-- [![npm version](https://badge.fury.io/js/corozo.svg)](https://www.npmjs.com/corozo) -->

corozo's dream is to achieve what [GraphQL](https://graphql.org/learn) but in a much simpler way; corozo expressible (and type-safe) JSON syntax allows to query/update the data, and gives the power to ask for exactly what is necessary and nothing else.

GraphQL already allows to do that, but it requires to configure [additional servers](https://graphql.org/learn/execution) and to learn a [new syntax](https://graphql.org/learn/queries); in the other hand, corozo is a plug & play library which can be used with (and without) any NodeJs framework (like `express`, restify, hapi, koa...). 

corozo's syntax is inspired in MongoDb, JPA, TypeORM and GraphQL. One can simply declare the entities (DTOs), add some decorators to them as metadata, and then start using the (type-safe) JSON syntax to send complex (and auto-sanitized) query-expressions from the frontend/client to the backend/server (like GraphQL allows).

Most important corozo features are:

- supports on-demand `populate` (at multiple levels), `projection` of fields/columns, complex `filtering`, `grouping`,
  and `pagination`.
- declarative and imperative `transactions`
- generic and custom `repositories`
- `relations` between entities
- supports `inheritance` patterns
- connection pooling
- supports Postgres, MySQL, MariaDB, SQLite (WIP), MongoDB (WIP), more soon
- code is readable, performant and flexible

Steps to use:

- Be sure to enable (set as `true`) the following two properties in the `tsconfig.json` file of your `TypeScript` project: `experimentalDecorators` and `emitDecoratorMetadata`
- Declare the entities (notice inheritance is optional)

```typescript
export abstract class BaseEntity {
  @PrimaryColumn()
  id?: number;
  @ManyToOne({ type: () => Company })
  @Column({ mode: 'insert' })
  company?: number | Company;
  @Column({ mode: 'insert' })
  @ManyToOne({ type: () => User })
  user?: number | User;
  @Column({ mode: 'insert' })
  createdAt?: number;
  @Column({ mode: 'update' })
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
  @PrimaryColumn({ name: 'pk' })
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

- initialize `corozo` configuration:

```typescript
import { initCorozo } from '@corozo/core';
import { GenericServerRepository } from '@corozo/core/repository';
// `pg` is for postgres driver, other databases are supported.
initCorozo({ datasource: { driver: 'pg' }, defaultRepositoryClass: GenericServerRepository });
```

- your service logic will look like this:

```typescript
const users = await querier.find(User, { project: { id: 1, name: 1 }, filter: { company: 123 }, limit: 100 });
```

...
