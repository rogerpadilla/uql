# [nukak](https://nukak.org) &middot; [![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/rogerpadilla/nukak/blob/main/LICENSE) [![tests](https://github.com/rogerpadilla/nukak/actions/workflows/tests.yml/badge.svg)](https://github.com/rogerpadilla/nukak) [![coverage status](https://coveralls.io/repos/rogerpadilla/nukak/badge.svg?branch=main)](https://coveralls.io/r/rogerpadilla/nukak?branch=main) [![npm version](https://badge.fury.io/js/nukak.svg)](https://badge.fury.io/js/nukak)

Learn more of `nukak` on its website https://nukak.org

## Quick Start

`nukak` is a flexible and efficient `ORM`, with declarative `JSON` syntax and really smart type-safety.

The `nukak` queries can be safely written in the frontend (browser/mobile) and sent to the backend; or only use `nukak` in the backend, or even in a mobile app with an embedded database (like `sqlite`).

### <a name="features"></a> Features

- `JSON` (serializable) syntax for all the [queries](https://nukak.org/docs/querying-logical-operators).
- uses the power of `TypeScript` to get smart type-safety [everywhere](https://nukak.org/docs/api-repository).
- the generated queries are [performant](https://nukak.org/docs/querying-retrieve-relations), safe, and human-readable.
- `$project`, `$filter`, `$sort`, `$limit` works at [multiple levels](https://nukak.org/docs/querying-retrieve-relations) (including deep relations and their fields).
- [declarative](https://nukak.org/docs/transactions-declarative) and [imperative](https://nukak.org/docs/transactions-imperative) `transactions`.
- [soft-delete](https://nukak.org/docs/entities-soft-delete), [virtual fields](https://nukak.org/docs/entities-virtual-fields), [repositories](https://nukak.org/docs/api-repository), `connection pooling`.
- transparent support for [inheritance](https://nukak.org/docs/entities-advanced) between entities.
- supports `Postgres`, `MySQL`, `MariaDB`, `SQLite`, `MongoDB`.

### <a name="installation"></a> Installation

1. Install the `nukak` main package:

```sh
npm install nukak --save
```

2. Install one of the specific adapters for your database:

| Database     | Package          |
| ------------ | ---------------- |
| `PostgreSQL` | `nukak-postgres` |
| `MySQL`      | `nukak-mysql`    |
| `MariaDB`    | `nukak-maria`    |
| `MongoDB`    | `nukak-mongo`    |
| `SQLite`     | `nukak-sqlite`   |

E.g. use `nukak-postres` adapter for `Postgres`

```sh
npm install nukak-postgres --save
```

3. Additionally, your `tsconfig.json` may need the following flags:

```json
"target": "es2020",
"experimentalDecorators": true,
"emitDecoratorMetadata": true
```

### <a name="configuration"></a> Configuration

A default querier-pool can be set in any of the bootstrap files of your app (e.g. in the `server.ts`).

```ts
import { setQuerierPool } from 'nukak';
import { PgQuerierPool } from 'nukak-postgres';

const querierPool = new PgQuerierPool(
  {
    host: 'localhost',
    user: 'theUser',
    password: 'thePassword',
    database: 'theDatabase',
  },
  // a logger can optionally be passed so the SQL queries are logged
  console.log
);

setQuerierPool(querierPool);
```

### <a name="definition-of-entities"></a> Definition of Entities

Take any dump class (aka DTO) and annotate it with the decorators from `nukak/entity`.

```ts
import { v4 as uuidv4 } from 'uuid';
import { Field, ManyToOne, Id, OneToMany, Entity, OneToOne, ManyToMany } from 'nukak/entity/index.js';

@Entity()
export class Profile {
  /**
   * primary-key.
   * the `onInsert` callback can be used to specify a custom mechanism for auto-generating
   * the default value of a field when inserting a new record.
   */
  @Id({ onInsert: uuidv4 })
  id?: string;
  @Field()
  picture?: string;
  /**
   * foreign-keys are really simple to specify.
   */
  @Field({ reference: () => User })
  creatorId?: string;
}

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
  /**
   * `mappedBy` can be a callback or a string (callback is useful for auto-refactoring).
   */
  @OneToOne({ entity: () => Profile, mappedBy: (profile) => profile.creatorId, cascade: true })
  profile?: Profile;
}

@Entity()
export class MeasureUnitCategory {
  @Id({ onInsert: uuidv4 })
  id?: string;
  @Field()
  name?: string;
  @OneToMany({ entity: () => MeasureUnit, mappedBy: (measureUnit) => measureUnit.category })
  measureUnits?: MeasureUnit[];
}

@Entity()
export class MeasureUnit {
  @Id({ onInsert: uuidv4 })
  id?: string;
  @Field()
  name?: string;
  @Field({ reference: () => MeasureUnitCategory })
  categoryId?: string;
  @ManyToOne({ cascade: 'persist' })
  category?: MeasureUnitCategory;
}
```

### <a name="query-data"></a> Query the data

```ts
import { getQuerier } from 'nukak';
import { Transactional, InjectQuerier } from 'nukak/querier/index.js';
import { User } from './shared/models/index.js';

export class UserService {
  @Transactional()
  async getUsers(@InjectQuerier() querier?: Querier): Promise<User[]> {
    return querier.findMany(User, {
      $project: { id: true, email: true, profile: ['picture'] },
      $filter: { email: { $iendsWith: '@google.com' } },
      $sort: { createdAt: -1 },
      $limit: 100,
    });
  }
}
```

---

See more in https://nukak.org :high_brightness:
