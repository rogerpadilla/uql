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

Entities are classes; a query is a JSON object checked key by key against the entity; the same query runs on every database UQL supports. There is no schema file, no generated client, and no query builder.

The full docs are Markdown at https://uql-orm.dev/llms.txt, one page per URL. Read the page for the task before guessing an option: every page listed there is a `.md` URL.

## Setup

```sh
npm install uql-orm pg   # or mysql2, mariadb, better-sqlite3, mongodb, @libsql/client, ...
```

ESM only. Node 24+, Bun, Deno or an edge runtime, TypeScript 5.7+. Decorators are the TC39 standard: never enable `experimentalDecorators` or `emitDecoratorMetadata`, never import `reflect-metadata`. In `tsconfig.json`, `module` is `nodenext` or `preserve`, and `target` is a dated one (`es2022`+), not `esnext`.

Node's type stripping runs no decorators: on Node, add `tsx` (`npm i -D tsx`), which `uql-migrate` imports `uql.config.ts` through. Next.js compiles TC39 decorators only through a `babel.config.json` with `@babel/plugin-proposal-decorators` at `version: '2023-11'`. A bundle that minifies class names (Next's server build, or any bundler's `minify`) needs `@Entity({ name: 'todo' })`: a table name is the class name otherwise.

```ts
// uql.config.ts
import type { Config } from 'uql-orm';
import { PgQuerierPool } from 'uql-orm/postgres';
import { Post, User } from './entities.js';

export const pool = new PgQuerierPool({ connectionString: process.env.DATABASE_URL });

export default { pool, entities: [User, Post] } satisfies Config;
```

Each driver has its own entry point: `uql-orm/postgres`, `uql-orm/mysql`, `uql-orm/mariadb`, `uql-orm/sqlite`, `uql-orm/mongodb`, `uql-orm/libsql`, `uql-orm/turso`, `uql-orm/neon`, `uql-orm/d1`, `uql-orm/pglite`, `uql-orm/bun-sql`, `uql-orm/mssql`, `uql-orm/cockroachdb`. Build the pool once per process and import it.

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

- Every `@Field` states its `type`: `String`, `Number`, `Boolean`, `Date`, `BigInt`, or a column type such as `'uuid'`, `'text'`, `'jsonb'`. A foreign key takes `references` instead and inherits the target key's type. A `Date` is an instant, stored in UTC to the millisecond on every engine; `precision` sets other fractional digits. A `'decimal'` is exact text (`price?: string | null`); `type: Number` with `precision`/`scale` opts in to a rounding JS number. A JSON column of no fixed shape is a bare `Json`.
- A column is nullable unless it says `nullable: false`, and its property must admit `null` to match: `title?: string | null`. A property typed without `| null` on a nullable column is a compile error.
- Declare a `nullable: false` column `!` (`email!: string`): reads have it and inserts must name it, except a single-column key and a `version`, which uql fills. Declare `?` whatever an insert may leave out: a nullable, `onInsert`, `defaultValue`, `eager: false` or `computed` field, and relations.
- An engine's own column type is a `raw` constant, ``columnType: raw`tsvector` ``, rendered verbatim and carrying its own `length`/`precision`: never a bare string.
- `defaultValue` is a value of the field's type (a JSON column's document, `[]` or `{}`), or SQL the database evaluates per row: one of `currentTimestamp`, `currentDate`, `currentTime`, `uuid` (not SQLite), `uuidv7` (Postgres 18+, MariaDB 11.7+), or ``raw`...` ``. A string is always text, `'CURRENT_TIMESTAMP'` included. The migration builder takes the same.
- `currentTimestamp` is the database clock, UTC to the millisecond on every engine, where a raw `CURRENT_TIMESTAMP` is not on SQLite, MySQL or SQL Server. Use it for a default, a stamp, `onUpdate` or `$where`.
- Members are named by callbacks, never by strings: `mappedBy: (post) => post.author`, `references: (post) => post.authorId`.
- `@ManyToMany({ entity: () => Tag, through: () => PostTag })` names its junction entity.
- `cascade: true` makes writes reach a relation's rows, in one transaction. A to-one holding the key takes `'persist'` only: its target is written first, and `{ id }` links an existing one. An update replaces a to-many's rows and a many-to-many's links: the listed ones are saved or kept, the rest removed.
- `@Index((post) => [post.authorId], { where: { archived: { $ne: true } } })` states a partial index's filter as the predicate the query passes, never as `raw`: a planner matches the two by shape, so `raw` that means the same thing leaves the index unused.
- `@Field({ type: Number, version: true })`, with `[versionKey]?: 'version'` on the class, is an optimistic lock: an update must carry the version it read (a compile error otherwise), and one against a row someone else moved on throws `UqlOptimisticLockError` (kind `optimisticLock`, HTTP 409). Its updates name one row by its id; save and upsert are refused.
- `@Field({ computed })` is a value the database produces, on a `readonly` property: SQL over the row, ``(u) => raw`${u.first} || ' ' || ${u.last}` ``, or a relation aggregate, `(order) => order.items.count()`. `stored: true` makes the SQL a generated column; `stored: ['insert', 'update']` makes it a stamp, which a trigger writes on those events whoever writes the row (`computed: currentTimestamp`), where `onUpdate` covers only uql's own writes.
- `@Trigger({ on: 'afterUpdate', of: (post) => [post.status], where: { $old: { status: 'draft' } }, run })` is a trigger the database fires. `run(newRow, oldRow)` returns the body, written with `insertInto`, `upsertInto` (as `upsertOne` takes it), `updateTable`, `deleteFrom` and `refuse(message)` (fails the write), which are typed by the entity written and render on every engine; `deferred: true` fires an after trigger at commit, on Postgres only; anything else is `raw` SQL over the rows, per engine where they differ. A trigger's writes skip uql's fills and entity filters, soft delete included. MongoDB has none. Details, SQL Server's per-statement shape included: https://uql-orm.dev/entities/triggers.md
- `defineEntity` defines the same entity without decorators: https://uql-orm.dev/entities/imperative.md

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

- The keys are `$select`, `$exclude`, `$where`, `$populate`, `$count`, `$distinct`, `$sort`, `$skip`, `$limit`; `$count: { posts: true }` tallies a to-many under `_count` without loading it.
- `$sort` takes `'asc'`/`1` or `'desc'`/`-1`, and `'ascNullsLast'`, `'ascNullsFirst'`, `'descNullsFirst'` or `'descNullsLast'` to say where nulls land, which reads the same on every engine (emulated where there is no `NULLS FIRST`). Unqualified, each engine keeps its own answer: Postgres sorts nulls last on `asc`, the rest sort them first.
- `findManyPage(User, { $sort: { createdAt: -1, id: 1 }, $limit: 20, $after })` pages by cursor, so page 1,000 costs what page 1 does, and answers `{ items, startCursor, endCursor, hasNextPage, hasPrevPage }`: pass `endCursor` as `$after`, or `startCursor` as `$before` to go back. `$sort` must include the key or a unique `nullable: false` field, uses the entity's own fields, and takes no `$skip`. A nullable leading sort key pages correctly but cannot use an index.
- `$where` takes a value for equality or an operator map: `$eq`, `$ne`, `$lt`, `$lte`, `$gt`, `$gte`, `$in`, `$nin`, `$between`, `$like`, `$ilike`, `$regex`, `$startsWith`, `$endsWith`, `$includes`, `$isNull`, `$isNotNull`. `$and`, `$or`, `$not` and `$nor` combine clauses.
- An `undefined` anywhere in `$where` throws instead of filtering by nothing: leave the key out not to filter by it (`...(email && { email })`), or name `null`.
- NULL compares the way the engine compares it: on SQL, `$ne`, `$nin`, `$not` and `$nor` leave out a NULL row, where MongoDB keeps it. Name NULL where you want it, `{ $or: [{ col: { $ne: 'a' } }, { col: null }] }`; ask for NULL with `{ col: null }` and its absence with `{ col: { $ne: null } }`.
- `$text: { $value }` in `$where` searches text on every engine with full-text search, through the entity's `@Index(..., { type: 'fulltext', config })`, whose columns may carry a `weight`. `$sort: { $text: 'desc' }` ranks by relevance, and `{ $text: { $project: 'score' } }` also returns it, typed with `WithProjection<E, 'score'>`.
- A result is narrowed to what the query selected and populated: reading an unselected field is a compile error. Name that shape with `QueryFindResult<User, 'id' | 'email'>` rather than widening the query.
- `$populate` loads relations in the same statement. Nothing is lazy: a relation not populated is not there.
- A query is plain data, so it can be built dynamically, stored, or sent from a browser to `uql-orm/http`, whose handler serves only the entities its required `include` names.
- Methods: `findMany`, `findOne`, `findOneById`, `findManyAndCount`, `findManyPage`, `findManyStream`, `count`, `exists`, `aggregate`, `insertOne`, `insertMany`, `updateOneById`, `updateMany`, `saveOne`, `saveMany`, `upsertOne`, `upsertMany`, `deleteOneById`, `deleteMany`. Each takes the entity class first.
- `upsertOne(Entity, { email: true }, row, update?)`: a conflicting row takes `update`, an update's payload with its operators (`{ uses: { $inc: 1 } }`), instead of `row`; a new one inserts `row`. An empty `{}` leaves a conflicting row as it is: insert if absent. Cascaded relations write on either branch, a found row's replaced, as `updateMany` does. It resolves to the row's id.
- Every write takes `{ returning: { id: true, createdAt: true } }` as its last argument and then resolves to those rows (an update or delete by id: the row or `undefined`), read back in the same transaction; without it, inserts, saves and upserts resolve to ids, updates and deletes to a count.
- `updateMany` and `deleteMany` naming no rows - no `$where` holding a value (an empty group holds none), no `$limit` - throw; `{ unfiltered: true }` means the whole table.
- An update takes `{ stock: { $inc: -1 } }` to add, or `$mul` to multiply, in the statement, a NULL counting as 0, so a guard in `$where` (`stock: { $gte: 1 }`) makes a decrement race-safe. On SQL the step may be a ref or `raw` of the field's type (`{ total: { $inc: newRow.amount } }` in a trigger). JSON fields take `$set`, `$unset`, `$push`, `$pull`.
- `$lock: true` locks the rows a read returns (`{ $wait: 'skip' | 'nowait' }` says what to do about a row someone else holds) and needs an open transaction; SQLite, libSQL, Turso, D1 and MongoDB have no row lock and refuse it.
- `queryErrorKind(err)` names any failure the same on every engine - `uniqueViolation`, `foreignKeyViolation`, `notNullViolation`, `checkViolation`, `optimisticLock`, `retryable`, `usage`, `security` - so catch by kind rather than by a driver's code or an `instanceof`. Every error UQL raises itself is a `UqlError`.
- ``pool.all`SELECT ... WHERE id = ${id}` `` runs a `SELECT` and ``pool.run`...` `` a write: both are tags, each interpolated value bound: a scalar, `null` or a list of them, never `undefined` or a plain object (bind `JSON.stringify(doc)`). `raw` builds a fragment to embed anywhere a value or field goes, or to compose a statement, and `raw.join(fragments, ' AND ')` joins them. `raw.text(sql)` runs trusted SQL held in a string, binding nothing: never build it from user input. Migrations write ``querier.run`CREATE TABLE ...` ``. `raw` is a tag, so ``raw(`...`)`` does not compile. A field read off `refs(Entity)` carries its type: on its own as a value it fits only a field of that type.

## Connections and transactions

Every method is on both the pool and a querier. A pool call acquires a connection for that call and releases it. To run several operations on one connection, or atomically, hold a querier:

```ts
await pool.transaction(async (querier) => {
  const userId = await querier.insertOne(User, { email: 'ada@uql-orm.dev' });
  await querier.insertOne(Post, { title: 'Hello', authorId: userId });
});
```

The callback commits when it returns and rolls back when it throws; `beginTransaction` / `commitTransaction` / `rollbackTransaction` are for a transaction that opens in one place and ends in another. Inside the callback, a `pool` call runs on the callback's querier, so it is part of the transaction. A `transaction()` inside another is a savepoint, whose failure undoes its own writes alone (MongoDB, with none, refuses it). A transaction holds its connection: a statement from outside its callback waits for it. `querier.onCommit(fn)` (or a hook's `onCommit`) runs `fn` after the outermost commit, never on a rollback: use it for mails and queued jobs. A querier from `pool.getQuerier()` is yours to release: bind it with `await using`.

A `findManyStream` holds its querier until the loop ends, which refuses any other statement meanwhile: inside the loop, run them on another connection; inside a transaction, or on SQLite and PGlite (one shared connection), run them after the loop. That includes an `@AfterLoad` querying through its `querier` on a streamed row. A statement binding more values than the engine takes (100 on D1, 2098 on SQL Server) is refused too: split a long `$in`.

## Migrations

`npx uql-migrate` reads `uql.config.ts` (`bun --bun uql-migrate` on Bun):

- `sync` applies what the entities imply (development only).
- `generate:entities` writes the diff as a migration file to review. It renames a column a naming strategy spells otherwise (`firstName` to `first_name`); any other renamed column is a drop and an add it warns about, with the `renameColumn(table, from, to)` to write instead. It refuses a required column with no default on a table holding rows.
- `up` and `down` apply and revert migrations, each in its own transaction, holding a lock so concurrent instances run each migration once. From code, `await new Migrator(pool, { migrationsPath }).up()` before the app starts: it rejects with the first failing migration's error, the ones before it applied. `down()` reverts the last one; `down({ step: Infinity })` every one.
- `generate:from-db` writes entity classes from an existing database.
- `drift:check` fails when the database no longer matches.
- `sync --dry-run` prints only SQL on stdout, to append to a migration file another tool applies: on Cloudflare D1, wrangler's (https://uql-orm.dev/cloudflare-d1.md).

Checks, an enum's included, and triggers are part of the diff: uql owns the `_uql_`-prefixed ones and never touches another. On MongoDB, checks and enums are the collection's validator, which uql owns whole, and a check fails a document lacking the field it compares.

## Where to read more

- Operators, per-dialect SQL: https://uql-orm.dev/querying/comparison-operators.md
- Relations and deep `$populate`: https://uql-orm.dev/querying/relations.md
- Computed fields and stamps: https://uql-orm.dev/entities/computed-fields.md
- Triggers: https://uql-orm.dev/entities/triggers.md
- Every method's signature: https://uql-orm.dev/querying/methods.md
- Coming from Prisma, Drizzle, TypeORM or MikroORM: https://uql-orm.dev/switching-to-uql.md
- Breaking changes by version: https://uql-orm.dev/upgrade-guide.md
