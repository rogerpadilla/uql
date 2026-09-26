---
name: uql-orm
description: >
  Write code with UQL (the uql-orm package), the TypeScript ORM whose queries are plain JSON objects,
  on PostgreSQL, MySQL, MariaDB, SQLite, CockroachDB, SQL Server, MongoDB, Turso, Neon, D1 and PGlite.
  Use when a project imports uql-orm, or when defining entities or triggers, querying, populating relations,
  writing transactions, raw SQL or migrations with it. UQL is not Prisma, Drizzle, TypeORM or MikroORM:
  their APIs do not carry over.
---

# UQL

Entities are classes; a query is a JSON object checked key by key against the entity; the same query runs
on every database UQL supports. There is no schema file, no generated client, and no query builder.

The full docs are Markdown at https://uql-orm.dev/llms.txt, one page per URL. Read the page for the task
before guessing an option: every page listed there is a `.md` URL.

## Setup

```sh
npm install uql-orm pg   # or mysql2, mariadb, better-sqlite3, mongodb, @libsql/client, ...
```

ESM only. Node 24+, Bun, Deno or an edge runtime, TypeScript 5.2+. Decorators are the TC39 standard:
never enable `experimentalDecorators` or `emitDecoratorMetadata`, never import `reflect-metadata`.
In `tsconfig.json`, `module` is `nodenext` or `preserve`, and `target` is a dated one (`es2022`+), not `esnext`.

```ts
// uql.config.ts
import type { Config } from 'uql-orm';
import { PgQuerierPool } from 'uql-orm/postgres';
import { Post, User } from './entities.js';

export const pool = new PgQuerierPool({ connectionString: process.env.DATABASE_URL });

export default { pool, entities: [User, Post] } satisfies Config;
```

Each driver has its own entry point: `uql-orm/postgres`, `uql-orm/mysql`, `uql-orm/maria`, `uql-orm/sqlite`,
`uql-orm/mongo`, `uql-orm/libsql`, `uql-orm/turso`, `uql-orm/neon`, `uql-orm/d1`, `uql-orm/pglite`,
`uql-orm/bunSql`, `uql-orm/mssql`, `uql-orm/cockroachdb`. Build the pool once per process and import it.

## Entities

```ts
import { Entity, Field, Id, ManyToOne, OneToMany } from 'uql-orm';

@Entity()
export class User {
  @Id({ type: 'uuid', onInsert: () => crypto.randomUUID() })
  id?: string;

  @Field({ type: String, unique: true, nullable: false })
  email?: string;

  @OneToMany({ entity: () => Post, mappedBy: (post) => post.author })
  posts?: Post[];
}

@Entity()
export class Post {
  @Id({ type: Number })
  id?: number;

  @Field({ type: String })
  title?: string | null;

  @Field({ references: () => User })
  authorId?: string | null;

  @ManyToOne({ entity: () => User, references: (post) => post.authorId })
  author?: User;
}
```

- Every `@Field` states its `type` (`String`, `Number`, `Boolean`, `Date` (an instant, bound and read as UTC on every engine; `TIMESTAMPTZ` on Postgres and CockroachDB, `DATETIME(3)` on MySQL and MariaDB; `precision` sets its fractional-second digits), `BigInt`, or a column type such as `'uuid'`, `'text'`, `'jsonb'`), except a foreign key, which takes `references` and inherits the target key's type.
- A column is nullable unless it says `nullable: false`, and its property must admit `null` to match: `title?: string | null`. A property typed without `| null` on a nullable column is a compile error.
- An engine's own column type is a `raw` constant, ``columnType: raw`tsvector` ``, rendered verbatim and carrying its own `length`/`precision`: never a bare string.
- Members are named by callbacks, never by strings: `mappedBy: (post) => post.author`, `references: (post) => post.authorId`.
- `@ManyToMany({ entity: () => Tag, through: () => PostTag })` names its junction entity.
- `@Index((post) => [post.authorId], { where: { archived: { $ne: true } } })` states a partial index's filter as the predicate the query passes, never as `raw`: a planner matches the two by shape, so `raw` that means the same thing leaves the index unused.
- `@Field({ type: Number, version: true })`, with `[versionKey]?: 'version'` on the class, is an optimistic lock:
  an update must carry the version it read (a compile error otherwise), and one against a row someone else moved on throws `UqlOptimisticLockError` (kind `optimisticLock`, HTTP 409). Its updates name one row by its id; save and upsert are refused.
- `@Field({ computed })` is a value the database produces, on a `readonly` property: SQL over the row, ``(u) => raw`${u.first} || ' ' || ${u.last}` ``, or a relation aggregate, `(order) => order.items.count()`.
  `stored: true` makes the SQL a generated column; `stored: ['insert', 'update']` makes it a stamp, a trigger writing it on those events whoever writes the row (``computed: raw`CURRENT_TIMESTAMP` ``), where `onUpdate` covers only uql's own writes.
- `@Trigger({ on: 'afterUpdate', of: (post) => [post.status], where: { $old: { status: 'draft' } }, run })` is a trigger the database fires (`defineEntity`'s `triggers` or `defineTrigger` without decorators); `where` holds a `$where` predicate per row it names, or SQL off the rows. `run` takes `(newRow, oldRow)`, each only where the event has it (no `oldRow` on insert, no `newRow` on delete), and returns the body: `insertInto(Audit, { postId: newRow.id })`, `updateTable(Audit, { $where: { postId: newRow.id } }, { status: newRow.status })` or `deleteFrom(Audit, { $where: { postId: oldRow.id } })`, typed by the entity written and rendered on every engine (no `onInsert`/`onUpdate` fills, so an insert names each field uql fills on insert unless its column has a `defaultValue`; `$where` reads the entity's own fields; no entity filters, security ones included, so a soft-delete entity is hard-deleted; an update or delete naming no rows is refused; no `$inc`/`$mul`/`$push` on SQL Server), several joined in one `raw`. Anything else is `raw` SQL over the refs, one body for every engine or `{ postgres, mssql, ... }` where they differ (SQL Server fires per statement, reading `inserted`/`deleted` as tables, with no `before*`; `of` and `where` narrow what the write helpers read there, so SQL of its own is refused beside them). MongoDB has none, and refuses a write to an entity declaring one.
- `defineEntity` defines the same entity without decorators: https://uql-orm.dev/entities/imperative.md

## Queries

```ts
import { pool } from './uql.config.js';
import { User } from './entities.js';

const users = await pool.findMany(User, {
  $select: { id: true, email: true },
  $where: { email: { $endsWith: '@uql-orm.dev' }, $or: [{ id: 'a' }, { id: 'b' }] },
  $populate: { posts: { $select: { title: true }, $sort: { id: 'desc' }, $limit: 5 } },
  $sort: { email: 'asc' },
  $skip: 0,
  $limit: 20,
});
```

- The keys are `$select`, `$exclude`, `$where`, `$populate`, `$count`, `$distinct`, `$sort`, `$skip`, `$limit`;
  `$count: { posts: true }` tallies a to-many under `_count` without loading it.
- `$sort` takes `'asc'`/`1` or `'desc'`/`-1`, and `'ascNullsLast'`, `'ascNullsFirst'`, `'descNullsFirst'` or
  `'descNullsLast'` to say where nulls land, which reads the same on every engine (emulated where there is no
  `NULLS FIRST`). Unqualified, each engine keeps its own answer: Postgres and CockroachDB sort nulls last on `asc`,
  the rest sort them first.
- `$where` takes a value for equality or an operator map: `$eq`, `$ne`, `$lt`, `$lte`, `$gt`, `$gte`, `$in`,
  `$nin`, `$between`, `$like`, `$ilike`, `$regex`, `$startsWith`, `$endsWith`, `$includes`, `$isNull`,
  `$isNotNull`. `$and`, `$or`, `$not` and `$nor` combine clauses.
- NULL compares the way the engine compares it: on SQL, `$ne`, `$nin`, `$not` and `$nor` leave out a NULL row, where MongoDB keeps it. Name NULL where you want it, `{ $or: [{ col: { $ne: 'a' } }, { col: null }] }`; ask for NULL with `{ col: null }` and its absence with `{ col: { $ne: null } }`.
- `$text: { $value }` in `$where` searches text on every engine with full-text search, through the entity's
  `@Index(..., { type: 'fulltext', config })`, whose columns may carry a `weight`. `$sort: { $text: 'desc' }` ranks by
  relevance, and `{ $text: { $project: 'score' } }` also returns it, typed with `WithProjection<E, 'score'>`.
- A result is narrowed to what the query selected and populated: reading an unselected field is a compile error.
  Name that shape with `QueryFindResult<User, 'id' | 'email'>` rather than widening the query.
- `$populate` loads relations in the same statement. Nothing is lazy: a relation not populated is not there.
- A query is plain data, so it can be built dynamically, stored, or sent from a browser to `uql-orm/http`,
  whose handler serves only the entities its required `include` names.
- Methods: `findMany`, `findOne`, `findOneById`, `findManyAndCount`, `findManyStream`, `count`, `exists`,
  `aggregate`, `insertOne`, `insertMany`, `updateOneById`, `updateMany`, `saveOne`, `saveMany`, `upsertOne`,
  `upsertMany`, `deleteOneById`, `deleteMany`. Each takes the entity class first.
- `updateMany` and `deleteMany` naming no rows - no `$where` holding a value (an `undefined` or an empty group holds none), no `$limit` - throw; `{ unfiltered: true }` means the whole table.
- An update takes `{ stock: { $inc: -1 } }` to add, or `$mul` to multiply, in the statement, a NULL counting as 0,
  so a guard in `$where` (`stock: { $gte: 1 }`) makes a decrement race-safe. JSON fields take `$set`, `$unset`,
  `$push`, `$pull`.
- `$lock: true` locks the rows a read returns (`{ $wait: 'skip' | 'nowait' }` says what to do about a row
  someone else holds) and needs an open transaction; SQLite, libSQL, Turso, D1 and MongoDB have no row lock and
  refuse it.
- `queryErrorKind(err)` names any failure the same on every engine - `uniqueViolation`, `foreignKeyViolation`,
  `notNullViolation`, `checkViolation`, `optimisticLock`, `retryable`, `usage`, `security` - so catch by kind
  rather than by a driver's code or an `instanceof`. Every error UQL raises itself is a `UqlError`.
- `raw()` embeds SQL anywhere a value or field goes; `pool.all(sql, values)` runs a raw `SELECT`. A field read off `refs(Entity)` carries its type: on its own as a value it fits only a field of that type.

## Connections and transactions

Every method is on both the pool and a querier. A pool call acquires a connection for that call and releases it.
To run several operations on one connection, or atomically, hold a querier:

```ts
await pool.transaction(async (querier) => {
  const userId = await querier.insertOne(User, { email: 'ada@uql-orm.dev' });
  await querier.insertOne(Post, { title: 'Hello', authorId: userId });
});
```

Inside the callback, call `querier`, never `pool`: a `pool` call runs on another connection, outside the
transaction. A querier from `pool.getQuerier()` is yours to release: bind it with `await using`.

## Migrations

`npx uql-migrate` reads `uql.config.ts`. `sync` creates what the entities imply (development only);
`generate:entities` writes the diff as a migration file to review, renaming a column its field was renamed from, printing `renameTable` for a table that may have been, rebuilding a SQLite table for what it cannot alter, and refusing a required column with no default on a table holding rows; `up` applies migrations; `generate:from-db`
writes entity classes from an existing database; `drift:check` fails when the database no longer matches.
Triggers are part of the diff: uql installs its own under `_uql_`-prefixed names and never touches another.

## Where to read more

- Operators, per-dialect SQL: https://uql-orm.dev/querying/comparison-operators.md
- Relations and deep `$populate`: https://uql-orm.dev/querying/relations.md
- Computed fields and stamps: https://uql-orm.dev/entities/computed-fields.md
- Triggers: https://uql-orm.dev/entities/triggers.md
- Every method's signature: https://uql-orm.dev/querying/methods.md
- Coming from Prisma, Drizzle, TypeORM or MikroORM: https://uql-orm.dev/switching-to-uql.md
- Breaking changes by version: https://uql-orm.dev/upgrade-guide.md
