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

Full docs are Markdown: the index at https://uql-orm.dev/llms.txt, and each page at its URL plus `.md`. Read the page for the task before guessing an option. The whole site is one file at https://uql-orm.dev/llms-full.txt (about 530 KB), too large to load for one task.

## Setup

```sh
npm install uql-orm pg   # or mysql2, mariadb, better-sqlite3, mongodb, @libsql/client, ...
```

ESM only (a CommonJS app loads it through `require(esm)`). Needs Node 22.18+, Bun or an edge runtime, and TypeScript 5.7+.

Decorators are TC39 standard. Never enable `experimentalDecorators` or `emitDecoratorMetadata`, and never import `reflect-metadata`. In `tsconfig.json`, `module` is `nodenext` or `preserve`, and `target` is dated (`es2022`+), not `esnext`. A project already on legacy decorators (NestJS, Angular) keeps its config and defines entities with `defineEntity`. NestJS: https://uql-orm.dev/nestjs.md

Node's type stripping runs no decorators, so on Node add `tsx` (`npm i -D tsx`); `uql-migrate` loads `uql.config.ts` through it. Next.js needs `@babel/plugin-proposal-decorators` at `version: '2023-11'` in `babel.config.json`. A bundler that minifies class names needs `@Entity({ name: 'todo' })`, since the table name defaults to the class name.

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

- A class inherits its base's fields, relations, hooks, filters, indexes, checks and triggers. The base needs no `@Entity()` unless it is a table. A child entry with the same name replaces the base's.
- Every `@Field` states its `type`: `String`, `Number`, `Boolean`, `Date`, `BigInt`, or a column type such as `'uuid'`, `'text'`, `'jsonb'`. A foreign key takes `references` and inherits the target's type. A field read off `refs(Entity)` carries its type too. A JSON column of no fixed shape is a bare `Json`.
- A column is nullable unless it says `nullable: false`. Its property must admit `null`: `title?: string | null`. A property without `| null` on a nullable column is a compile error.
- `Date` is an instant, stored in UTC to the millisecond on every engine; `precision` sets other fractional digits. `'decimal'` is exact text (`price?: string | null`). `type: Number` with `precision`/`scale` opts into a rounding JS number.
- Declare a `nullable: false` column with `!` (`email!: string`). Declare `?` for anything an insert may omit: nullable, `onInsert`, `defaultValue`, `eager: false`, `computed` fields, and relations. A single-column key and a `version` are filled by uql.
- `defaultValue` is a value of the field's type, or SQL the database evaluates per row: `currentTimestamp`, `currentDate`, `currentTime`, `uuid` (not SQLite), `uuidv7` (Postgres 18+, MariaDB 11.7+), or ``sql`...` ``. A plain string is always text, `'CURRENT_TIMESTAMP'` included.
- `currentTimestamp` is the database clock, UTC to the millisecond on every engine. Use it for defaults, stamps, `onUpdate` and `$where`, not a raw `CURRENT_TIMESTAMP`.
- An engine's own column type is a `sql` constant: ``columnType: sql`tsvector` ``.
- Members are named by callbacks, never strings: `mappedBy: (post) => post.author`, `references: (post) => post.authorId`.
- `@ManyToMany({ entity: () => Tag, through: () => PostTag })` names the junction entity.
- `cascade: true` writes related rows in the same transaction. A to-one holding the key takes `'persist'`, and `{ id }` links an existing row. An update replaces a to-many's rows: listed ones are saved or kept, the rest removed.
- Partial index: `@Index((post) => [post.authorId], { where: { archived: { $ne: true } } })`. Write the predicate as a query, not `sql`, so the planner can match it. An unnamed partial index carries a hash of its `where` in its name, so editing the predicate replaces it.
- Optimistic lock: `@Field({ type: Number, version: true })` with `[versionKey]?: 'version'` on the class. An update must carry the version it read (a compile error otherwise). A stale one throws `UqlOptimisticLockError` (kind `optimisticLock`, HTTP 409). A versioned update names one row by its id. Save and upsert are refused for such an entity.
- Computed: `@Field({ computed })` on a `readonly` property, as SQL over the row ``(u) => sql`${u.first} || ' ' || ${u.last}` `` or a relation aggregate `(order) => order.items.count()`. `stored: true` makes a generated column. `stored: ['insert', 'update']` makes a stamp that a database trigger writes whoever writes the row. `onUpdate` covers only uql's own writes.
- `@Trigger({ on: 'afterUpdate', of: (post) => [post.status], where: { $old: { status: 'draft' } }, run })` is a trigger the database fires. `run(newRow, oldRow)` returns a body built from `insertInto`, `upsertInto`, `updateTable`, `deleteFrom` and `refuse(message)`, or raw `sql`. The builders are typed by the entity written and render on every engine. `deferred: true` fires an after trigger at commit, on Postgres only. A trigger's writes skip uql's fills and entity filters. A `deleteFrom` in a trigger deletes outright, even on a soft-delete entity: write a soft delete as an `updateTable`. MongoDB has no triggers. Details: https://uql-orm.dev/entities/triggers.md
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

- Query keys: `$select`, `$exclude`, `$where`, `$populate`, `$count`, `$distinct`, `$sort`, `$skip`, `$limit`. `$count: { posts: true }` counts a to-many under `_count` without loading it.
- Methods: `findMany`, `findOne`, `findOneById`, `findManyAndCount`, `findManyPage`, `findManyStream`, `count`, `exists`, `aggregate`, `insertOne`, `insertMany`, `updateOneById`, `updateMany`, `saveOne`, `saveMany`, `upsertOne`, `upsertMany`, `deleteOneById`, `deleteMany`. Each takes the entity class first, or the query's `$entity`. Signatures: https://uql-orm.dev/querying/methods.md
- Results are narrowed to what the query selected and populated. Reading an unselected field is a compile error. Name a shape with `QueryFindResult<User, 'id' | 'email'>`.
- `$populate` loads relations in the same statement. Nothing is lazy: an unpopulated relation is absent.
- In code generic over its entity, `{ [key]: 'asc' }` widens to an index signature. Take the member as a selector, `since: (keys: KeyMap<E>) => K`, read it with `keyOf(since)`, and sort with `sortOf<E>([[key, 'asc']])`. A selector follows a rename; a string key does not. `$where` and writes by a constant have no such builder: take a callback the caller writes against its own entity, `(state) => ({ state })`.
- `$sort` takes `'asc'`/`1` or `'desc'`/`-1`, plus `'ascNullsLast'`, `'ascNullsFirst'`, `'descNullsFirst'`, `'descNullsLast'`, which behave the same on every engine. Unqualified, each engine keeps its own null order.
- `$where` takes a value for equality or an operator map: `$eq`, `$ne`, `$lt`, `$lte`, `$gt`, `$gte`, `$in`, `$nin`, `$between`, `$like`, `$ilike`, `$regex`, `$startsWith`, `$endsWith`, `$includes`, `$isNull`, `$isNotNull`. Combine with `$and`, `$or`, `$not`, `$nor`. `$regex` is case-sensitive unless the pattern opens with `(?i)`.
- An `undefined` anywhere in `$where` throws. Leave the key out to skip the filter (`...(email && { email })`), or name `null`.
- NULL compares as the engine does: on SQL, `$ne`, `$nin`, `$not` and `$nor` drop NULL rows, where MongoDB keeps them. To keep them, name NULL: `{ $or: [{ col: { $ne: 'a' } }, { col: null }] }`. Ask for NULL with `{ col: null }` and its absence with `{ col: { $ne: null } }`.
- Full-text: `$text: { $value }` in `$where`, through an `@Index(..., { type: 'fulltext', config })`. `$sort: { $text: 'desc' }` ranks by relevance, and `{ $text: { $project: 'score' } }` returns the score, typed `WithProjection<E, 'score'>`.
- `findManyPage(User, { $sort: { createdAt: -1, id: 1 }, $limit: 20, $after })` pages by cursor, so page 1,000 costs what page 1 does. It returns `{ items, startCursor, endCursor, hasNextPage, hasPrevPage }`. Pass `endCursor` as `$after`, or `startCursor` as `$before`. `$sort` must end in the key or a unique `nullable: false` field, and takes no `$skip`. A nullable leading sort key pages correctly but cannot use an index.
- `upsertOne(Entity, { email: true }, row, update?)`: a conflicting row takes `update`, an update payload with operators (`{ uses: { $inc: 1 } }`). An empty `{}` leaves a conflicting row alone. Without `update`, a conflicting row takes the payload and its `onUpdate` fills, but keeps its own key: the payload's key, and its `onInsert` fills, apply only to a row it inserts. Cascaded relations write on either branch. Resolves to the row's id.
- Writes take `{ returning: { id: true } }` as their last argument and resolve to those rows, read back in the same transaction. Without it, inserts and upserts resolve to ids, and updates and deletes to a count. An update or delete writes exactly the rows it reports. One that reads its rows first holds them, so a racing writer waits for the commit. SQLite and MongoDB have no row locks and fail the racing writer with a retryable error instead.
- A query is plain data, so it can be sent from a browser to `uql-orm/http`. Its handler serves only the entities its required `include` names.
- `updateMany` and `deleteMany` that name no rows throw: no `$where` holding a value, and no `$limit`. Pass `{ unfiltered: true }` to mean the whole table.
- Updates use operators in the statement: `{ stock: { $inc: -1 } }` or `$mul`, with NULL counted as 0. Put a guard in `$where` (`stock: { $gte: 1 }`) to make a decrement race-safe. On SQL the step can be a ref or `sql` (`{ total: { $inc: newRow.amount } }` in a trigger).
- JSON fields take `$pull`, `$set`, `$push`, `$addToSet`, then `$unset`, applied in that order on one value. `$set` and `$unset` take keys or dotted paths and create parents: `settings: { $set: { 'billing.plan': 'pro' } }`. A JSON array (`tags?: Json<string[]>`) takes lists: `{ tags: { $pull: ['old'], $addToSet: ['new'] } }`.
- `$lock: true` locks the rows a read returns, and `{ $wait: 'skip' | 'nowait' }` says what to do about a row someone else holds. It needs an open transaction. SQLite, libSQL, Turso, D1 and MongoDB have no row lock and refuse it.
- `queryErrorKind(err)` names a failure the same on every engine: `uniqueViolation`, `foreignKeyViolation`, `notNullViolation`, `checkViolation`, `optimisticLock`, `retryable`, `usage`, `security`. Catch by kind, not by driver code. Every error UQL raises is a `UqlError`.
- Raw SQL: ``pool.all`SELECT ... WHERE id = ${id}` `` for a `SELECT`, ``pool.run`...` `` for a write. Interpolated values bind: a scalar, `null` or a list, never `undefined` or a plain object (bind `JSON.stringify(doc)`). `sql` builds a fragment, and `sql.join(fragments, ' AND ')` joins them. `sql.text(s)` runs trusted SQL held in a string. Never build it from user input. `sql` is a tag: ``sql(`...`)`` does not compile. `raw` is its deprecated name.

## Connections and transactions

Every method is on the pool and on a querier. A pool call takes a connection for that call. To run several operations on one connection, or atomically, use a transaction:

```ts
await pool.transaction(async (querier) => {
  const userId = await querier.insertOne(User, { email: 'ada@uql-orm.dev' });
  await querier.insertOne(Post, { title: 'Hello', authorId: userId });
});
```

The callback commits when it returns and rolls back when it throws. Inside it, `pool` calls run on its querier. A transaction holds its connection: a statement from outside its callback waits for it. A nested `transaction()` is a savepoint, whose failure undoes its own writes alone; MongoDB refuses it. For a transaction that opens in one place and ends in another, use `beginTransaction`, `commitTransaction` and `rollbackTransaction`. `{ readOnly: true }` opens a read-only transaction: Postgres, CockroachDB, MySQL and MariaDB refuse its writes, and libSQL and Turso skip the write lock they take at `BEGIN`. `querier.onCommit(fn)` runs `fn` after the outermost commit and never on rollback: use it for mail and queued jobs. A querier from `pool.getQuerier()` is yours to release: bind it with `await using`.

A call uql splits into several statements (an `insertMany` past the engine's bind cap, an `upsertMany` of mixed shapes) runs them all or none: one request on D1, libSQL, Turso and Neon (over HTTP), a transaction elsewhere, joining an open one.

A `findManyStream` holds its querier until the loop ends, and other statements on it are refused meanwhile. Inside the loop, run them on another connection. Inside a transaction, or on SQLite and PGlite (one shared connection), run them after the loop. That includes an `@AfterLoad` querying through its `querier` on a streamed row. A statement binding more values than the engine takes (100 on D1, 2098 on SQL Server, 32,767 on Neon) is refused: split a long `$in`.

## Migrations

`npx uql-migrate` reads `uql.config.ts` (`bun --bun uql-migrate` on Bun):

- `sync`: applies what the entities imply. Development only.
- `generate:entities`: writes the diff as a migration file to review. A renamed column is a drop and an add, unless a naming strategy maps it (`firstName` to `first_name`), or you write `renameColumn(table, from, to)`. It refuses a required column with no default on a table that holds rows.
- `up` and `down`: each migration runs in its own transaction, under a lock so concurrent instances run it once. From code, `await new Migrator(pool, { migrationsPath }).up()` before the app starts. It rejects with the first failing migration's error; the ones before it stay applied. `down()` reverts the last one, and `down({ step: Infinity })` reverts every one.
- `generate:from-db`: writes entity classes from an existing database.
- `drift:check`: fails when the database no longer matches. Index expressions and stored computed expressions are not compared, so change those by hand in the migration.
- `sync --dry-run`: prints only SQL on stdout, for a migration file another tool applies, such as wrangler on Cloudflare D1 (https://uql-orm.dev/cloudflare-d1.md).

In a migration, ``querier.run /*sql*/ `CREATE TABLE ...` `` marks the SQL: the comment is what es6-string-html highlights.

Checks, enums and triggers are part of the diff. uql owns the `_uql_`-prefixed checks and triggers and never touches another. On MongoDB, checks and enums are the collection's validator, which uql owns whole: a check fails a document that lacks the field it compares.

## Where to read more

- Operators and per-dialect SQL: https://uql-orm.dev/querying/comparison-operators.md
- Relations and deep `$populate`: https://uql-orm.dev/querying/relations.md
- Computed fields and stamps: https://uql-orm.dev/entities/computed-fields.md
- Triggers: https://uql-orm.dev/entities/triggers.md
- Coming from Prisma, Drizzle, TypeORM, MikroORM or Mongoose: https://uql-orm.dev/switching-to-uql.md
- Moving data off MongoDB: https://uql-orm.dev/mongodb.md#moving-to-sql
- Breaking changes by version: https://uql-orm.dev/upgrade-guide.md
