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

Entities are classes. A query is a JSON object checked key by key against the entity, and it runs the same on every supported database. There is no schema file, no generated client and no query builder.

Full docs are Markdown: the index at https://uql-orm.dev/llms.txt, and each page at its URL plus `.md`. Read the page for the task before guessing an option.

## Setup

```sh
npm install uql-orm pg   # or mysql2, mariadb, better-sqlite3, mongodb, @libsql/client, ...
```

ESM only. Needs Node 22.18+, Bun or an edge runtime, and TypeScript 5.7+.

Decorators are TC39 standard. Never enable `experimentalDecorators` or `emitDecoratorMetadata`, and never import `reflect-metadata`. A project on legacy decorators (NestJS, Angular) keeps its config and defines entities with `defineEntity`: https://uql-orm.dev/entities/imperative.md

Node runs no decorators natively yet, so add `tsx` there (`npm i -D tsx`); `uql-migrate` loads `uql.config.ts` through it. A bundler that minifies class names needs `@Entity({ name: 'todo' })`, since the table name defaults to the class name.

```ts
// uql.config.ts
import type { Config } from 'uql-orm';
import { PgQuerierPool } from 'uql-orm/postgres';
import { Post, User } from './entities.js';

export const pool = new PgQuerierPool({ connectionString: process.env.DATABASE_URL });

export default { pool, entities: [User, Post] } satisfies Config;
```

Driver entry points: `uql-orm/postgres`, `mysql`, `mariadb`, `sqlite`, `mongodb`, `libsql`, `turso`, `neon`, `d1`, `pglite`, `bun-sql`, `mssql`, `cockroachdb`. Build the pool once per process and import it.

## Entities

```ts
import { Entity, Field, Id, ManyToOne, OneToMany } from 'uql-orm';

@Entity()
export class User {
  @Id({ type: 'uuid', onInsert: () => crypto.randomUUID() })
  id!: string;

  @Field({ type: String, unique: true, nullable: false })
  email!: string;

  @OneToMany({ entity: () => Post, mappedBy: (post) => post.author })
  posts?: Post[];
}

@Entity()
export class Post {
  @Id({ type: Number })
  id!: number;

  @Field({ type: String })
  title?: string | null;

  @Field({ references: () => User })
  authorId?: string | null;

  @ManyToOne({ entity: () => User, references: (post) => post.authorId })
  author?: User;
}
```

- A class inherits its base's fields, relations, hooks, filters, indexes, checks and triggers. The base needs no `@Entity()` unless it is a table.
- Every `@Field` states its `type`: `String`, `Number`, `Boolean`, `Date`, `BigInt`, or a column type such as `'uuid'`, `'text'`, `'jsonb'`. A foreign key takes `references` and inherits the target's type. A JSON column of no fixed shape is a bare `Json`.
- A column is nullable unless it says `nullable: false`. Its property must admit `null` (`title?: string | null`).
- Declare a `nullable: false` column with `!` (`email!: string`). Declare `?` for anything an insert may omit: nullable, `onInsert`, `defaultValue`, `eager: false`, computed fields and relations. uql fills a single-column key and a `version`.
- `defaultValue` is a value of the field's type, or SQL the database evaluates per row: `currentTimestamp`, `currentDate`, `currentTime`, `uuid` (not SQLite), `uuidv7` (Postgres 18+, MariaDB 11.7+), or ``sql`...` ``. A plain string is always text, `'CURRENT_TIMESTAMP'` included.
- `Date` is an instant, stored in UTC to the millisecond on every engine. `'decimal'` is exact text (`price?: string | null`). `type: Number` with `precision`/`scale` opts into a rounding JS number.
- Members are named by callbacks, never strings: `mappedBy: (post) => post.author`, `references: (post) => post.authorId`.
- `@ManyToMany({ entity: () => Tag, through: () => PostTag })` names the junction entity. `cascade: true` writes related rows in the same transaction; an update replaces a to-many's rows.
- **MongoDB:** a key declared `Number` and left to the database is refused, since MongoDB only generates ObjectIds. Declare the key a `String`, or give it an `onInsert` generator.
- Optimistic lock: `@Field({ type: Number, version: true })` with `[versionKey]?: 'version'` on the class. An update must carry the version it read. A stale one throws `UqlOptimisticLockError` (kind `optimisticLock`, HTTP 409).
- Computed fields are `readonly` and read in any query that names them. As SQL over the row ``(u) => sql`${u.first} || ' ' || ${u.last}` ``, or as a relation aggregate: `@Field({ computed: (user) => user.resources.count() })`. `stored: true` makes a generated column.
- Partial index: `@Index((post) => [post.authorId], { where: { archived: { $ne: true } } })`. Write the predicate as a query, not `sql`.
- Triggers run in the database: `@Trigger({ on: 'afterUpdate', of: (post) => [post.status], run })`, where `run` returns a body built from `insertInto`, `upsertInto`, `updateTable`, `deleteFrom` and `refuse(message)`. A trigger's writes skip uql's fills and entity filters. MongoDB has no triggers: https://uql-orm.dev/entities/triggers.md

## Queries

```ts
import { User } from './entities.js';
import { pool } from './uql.config.js';

const users = await pool.findMany(User, {
  $select: { id: true, email: true },
  $where: { email: { $endsWith: '@uql-orm.dev' }, $or: [{ id: 'a' }, { id: 'b' }] },
  $populate: { posts: { $select: { title: true }, $sort: { id: 'desc' }, $limit: 5 } },
  $sort: { email: 'asc' },
  $skip: 0,
  $limit: 20,
});
```

- Query keys: `$select`, `$exclude`, `$where`, `$populate`, `$count`, `$distinct`, `$sort`, `$skip`, `$limit`. `$count: { posts: true }` counts a to-many under `_count` without loading it.
- Methods: `findMany`, `findOne`, `findOneById`, `findManyAndCount`, `findManyPage`, `findManyStream`, `count`, `exists`, `aggregate`, `insertOne`, `insertMany`, `updateOneById`, `updateMany`, `saveOne`, `saveMany`, `upsertOne`, `upsertMany`, `deleteOneById`, `deleteMany`. Each takes the entity class first, or the query's `$entity`. Signatures: https://uql-orm.dev/querying/methods.md
- Results are narrowed to what the query selected and populated. Reading an unselected field is a compile error. Name a shape with `QueryFindResult<User, 'id' | 'email'>`.
- `$populate` loads relations in the same statement. Nothing is lazy: an unpopulated relation is absent.
- `$sort` takes `'asc'`/`1` or `'desc'`/`-1`, plus `'ascNullsLast'`, `'ascNullsFirst'`, `'descNullsFirst'`, `'descNullsLast'`, which behave the same on every engine. Unqualified, each engine keeps its own null order.
- `$where` takes a value for equality or an operator map: `$eq`, `$ne`, `$lt`, `$lte`, `$gt`, `$gte`, `$in`, `$nin`, `$between`, `$like`, `$ilike`, `$regex`, `$startsWith`, `$endsWith`, `$includes`, `$isNull`, `$isNotNull`. Combine with `$and`, `$or`, `$not`, `$nor`. `$regex` is case-sensitive unless the pattern opens with `(?i)`.
- An `undefined` anywhere in `$where` throws. Leave the key out to skip the filter (`...(email && { email })`), or name `null`.
- NULL compares as the engine does: on SQL, `$ne`, `$nin`, `$not` and `$nor` drop NULL rows, where MongoDB keeps them. To keep them, name NULL: `{ $or: [{ col: { $ne: 'a' } }, { col: null }] }`.
- `findManyPage(User, { $sort: { createdAt: -1, id: 1 }, $limit: 20, $after })` pages by cursor, so page 1,000 costs what page 1 does. It returns `{ items, startCursor, endCursor, hasNextPage, hasPrevPage }`. `$sort` must end in the key or a unique `nullable: false` field, and takes no `$skip`.
- `upsertOne(Entity, { email: true }, row, update?)`: a conflicting row takes `update`, an update payload with operators. Without `update`, a conflicting row takes the payload but keeps its own key. Resolves to the row's id.
- Writes take `{ returning: { id: true } }` as their last argument and resolve to those rows. Without it, inserts and upserts resolve to ids, and updates and deletes to a count.
- `updateMany` and `deleteMany` that name no rows throw: no `$where` holding a value, and no `$limit`. Pass `{ unfiltered: true }` to mean the whole table.
- Updates use operators: `{ stock: { $inc: -1 } }` or `$mul`, with NULL counted as 0. Put a guard in `$where` (`stock: { $gte: 1 }`) to make a decrement race-safe.
- JSON fields take `$pull`, `$set`, `$push`, `$addToSet`, then `$unset`, applied in that order on one value. `$set` and `$unset` take keys or dotted paths and create parents: `settings: { $set: { 'billing.plan': 'pro' } }`.
- `$lock: true` locks the rows a read returns, and `{ $wait: 'skip' | 'nowait' }` says what to do about a row someone else holds. It needs an open transaction. SQLite, libSQL, Turso, D1 and MongoDB have no row lock and refuse it.
- `queryErrorKind(err)` names a failure the same on every engine: `uniqueViolation`, `foreignKeyViolation`, `notNullViolation`, `checkViolation`, `optimisticLock`, `retryable`, `usage`, `security`. Catch by kind, not by driver code.
- Raw SQL: ``pool.all`SELECT ... WHERE id = ${id}` `` for a `SELECT`, ``pool.run`...` `` for a write. Interpolated values bind: a scalar, `null` or a list, never `undefined` or a plain object. `sql` builds a fragment, and `sql.join(fragments, ' AND ')` joins them. `sql.text(s)` runs trusted SQL held in a string. Never build it from user input.

## Aggregates

Compute in SQL, not in code. Loading rows to dedupe, count or sum them in JavaScript costs a round trip and every row.

```ts
import { Post } from './entities.js';
import { pool } from './uql.config.js';

// Distinct values: a $group with no $select returns each once.
const titles = await pool.aggregate(Post, {
  $group: { title: true },
  $sort: { title: 1 },
});

// Tallies per group, in one statement.
const counts = await pool.aggregate(Post, {
  $group: { authorId: true },
  $select: { distinctTitles: { $countDistinct: { title: true } } },
});
```

- `$select` takes `$count` (`'*'` or a field), `$countDistinct`, `$sum`, `$avg`, `$min` and `$max`. Over no rows a count is `0` and the others are `null`.
- `$where` on the query filters rows before grouping. An operator's own `$where` filters only the rows that operator reads, which pivots rows into columns in one query: `{ $count: '*', $where: { published: true } }`.
- `$having` and `$sort` name a grouped column or a `$select` alias, never a field that is not grouped.
- A `$group` key can reach a to-one relation's field: `{ orderId: { transaction: { orderId: true } } }`. A to-many cannot be grouped, since it multiplies the rows.
- A per-row count belongs on the entity as a `computed` field, not as an aggregate per request. Counts for a read's rows: `$count: { posts: true }`.
- Details: https://uql-orm.dev/querying/aggregate.md

## Connections and transactions

Every method is on the pool and on a querier. A pool call takes a connection for that call. To run several operations on one connection, or atomically, use a transaction:

```ts
await pool.transaction(async (querier) => {
  const userId = await querier.insertOne(User, { email: 'ada@uql-orm.dev' });
  await querier.insertOne(Post, { title: 'Hello', authorId: userId });
});
```

The callback commits when it returns and rolls back when it throws. Inside it, `pool` calls run on its querier. A nested `transaction()` is a savepoint; MongoDB refuses it. For a transaction that opens in one place and ends in another, use `beginTransaction`, `commitTransaction` and `rollbackTransaction`. `querier.onCommit(fn)` runs `fn` after the outermost commit and never on rollback: use it for mail and queued jobs. A querier from `pool.getQuerier()` is yours to release: bind it with `await using`.

A `findManyStream` holds its querier until the loop ends, and other statements on it are refused meanwhile. Run them after the loop, or on another connection.

## Migrations

`npx uql-migrate` reads `uql.config.ts` (`bun --bun uql-migrate` on Bun):

- `sync`: applies what the entities imply. Development only.
- `generate:entities`: writes the diff as a migration file to review. A renamed column is a drop and an add, unless a naming strategy maps it or you write `renameColumn(table, from, to)`. It refuses a required column with no default on a table that holds rows.
- `up` and `down`: each migration runs in its own transaction, under a lock so concurrent instances run it once. From code, `await new Migrator(pool, { migrationsPath }).up()` before the app starts.
- `generate:from-db`: writes entity classes from an existing database.
- `drift:check`: fails when the database no longer matches the entities.
- `sync --dry-run`: prints only SQL on stdout, for a migration file another tool applies.

## Where to read more

- Operators and per-dialect SQL: https://uql-orm.dev/querying/comparison-operators.md
- Relations and deep `$populate`: https://uql-orm.dev/querying/relations.md
- Computed fields and stamps: https://uql-orm.dev/entities/computed-fields.md
- Coming from Prisma, Drizzle, TypeORM, MikroORM or Mongoose: https://uql-orm.dev/switching-to-uql.md
- Breaking changes by version: https://uql-orm.dev/upgrade-guide.md
