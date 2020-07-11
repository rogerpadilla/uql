**WIP**
#corozo

<!-- [![build status](https://travis-ci.org/rogerpadilla/corozo.svg?branch=master)](https://travis-ci.org/rogerpadilla/corozo?branch=master) -->
<!-- [![coverage status](https://coveralls.io/repos/rogerpadilla/corozo/badge.svg?branch=master)](https://coveralls.io/r/rogerpadilla/corozo?branch=master) -->
<!-- [![dependencies status](https://david-dm.org/rogerpadilla/corozo/status.svg)](https://david-dm.org/rogerpadilla/corozo/status.svg) -->
<!-- [![dev dependencies status](https://david-dm.org/rogerpadilla/corozo/dev-status.svg)](https://david-dm.org/rogerpadilla/corozo/dev-status.svg) -->
<!-- [![npm downloads](https://img.shields.io/npm/dm/corozo.svg)](https://www.npmjs.com/package/corozo) -->
<!-- [![npm version](https://badge.fury.io/js/corozo.svg)](https://www.npmjs.com/corozo) -->

The dream with `corozo` is to achieve what `GraphQL` does (TODO citation needed) but without the need to configure additional servers (TODO citation needed), it is just a plug & play library which can be use with any NodeJs framework (like `express`, `restify`, `hapi`, `koa`...), and additionally/optionally, can be used from the browser (to consume common REST APIs).

`corozo` is inspired in `MongoDb`, `Spring`, `TypeORM` and `GraphQL`. One can simply declare the entities (DTOs), add some decorators as metadata, and then start querying the DBs. The main advantage over, for example, `TypeORM`, is that `corozo` provides a type-safe JSON query syntax to allow sending complex (and auto-sanitized) query expressions from the frontend/client to the backend/server (like `GraphQL`).

Steps to use:

- Be sure to enable the following two flags in the corresponding tsconfig.json file: `experimentalDecorators` and `emitDecoratorMetadata`
- Declare the entities (inheritance is optional)

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

- start playing
  And your domain logic will look this way:

```typescript
const users = await querier.find(User, { project: { id: 1, name: 1 }, filter: { company: 123 }, limit: 100 });
```

...
