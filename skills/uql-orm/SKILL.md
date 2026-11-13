---
name: uql-orm
description: >
  Write code with UQL (the uql-orm package), the TypeScript ORM whose queries are plain JSON objects,
  on PostgreSQL, MySQL, MariaDB, SQLite, CockroachDB, SQL Server, MongoDB, Turso, Neon, D1 and PGlite.
  Use when a project imports uql-orm, or when defining entities (@Entity, defineEntity), triggers or filters
  (soft delete, multi-tenancy), querying ($where, $populate, findMany, aggregate), writing (insertMany, upsertOne,
  updateMany, returning), transactions, raw SQL (sql, refs), migrations (uql-migrate), or serving queries to a client
  (createApi, serve, createClientQuerier, createQueryOptions) with it. UQL is not Prisma,
  Drizzle, TypeORM or MikroORM: their APIs do not carry over.
---

# UQL

An entity is a decorated class, or declared as data with `defineEntity`, its row type derived. A query is a JSON object checked key by key against the entity, and it runs the same on every supported database. There is no schema file, no generated client and no query builder.

Full docs are Markdown: the index at https://uql-orm.dev/llms.txt, and each page at its URL plus `.md`. Read the page for the task before guessing an option.

## Setup

```sh
npm install uql-orm pg   # or mysql2, mariadb, better-sqlite3, mongodb, @libsql/client, ...
```

ESM only. Needs Node 22.18+, Bun or an edge runtime, and TypeScript 5.7+.

Decorators are TC39 standard. Never enable `experimentalDecorators` or `emitDecoratorMetadata`, and never import `reflect-metadata`. Node runs no decorators natively yet, so add `tsx` there (`npm i -D tsx`); `uql-migrate` loads `uql.config.ts` through it. A bundler that minifies class names needs `@Entity({ name: 'todo' })`, since the table name defaults to the class name.

```ts
// uql.config.ts
import type { Config } from 'uql-orm';
import { PgQuerierPool } from 'uql-orm/postgres';
import { Post, User } from './entities.js';

export const pool = new PgQuerierPool({ connectionString: process.env.DATABASE_URL });

export default { pool, entities: [User, Post] } satisfies Config;
```

Driver entry points: `uql-orm/postgres`, `mysql`, `mariadb`, `sqlite`, `mongodb`, `libsql`, `turso`, `neon`, `d1`, `pglite`, `bun-sql`, `mssql`, `cockroachdb`. Build the pool once per process and import it.

The pool's first argument is the driver's own config; set an acquire timeout there (`connectionTimeoutMillis` on the `pg` family), which otherwise waits forever. The second holds uql's options: `namingStrategy: new SnakeCaseNamingStrategy()` maps `createdAt` to `created_at` in queries and migrations alike (never name each column by hand), `logger: true` or a level list, `slowQuery: 200` (ms), and a default `schema`. Call `await pool.end()` on shutdown, except in serverless functions: https://uql-orm.dev/pool.md

## Entities

Two forms, mixable per entity, producing the same queries and types:

- **Decorators**: a named class type, and column-level foreign keys (`f.references`), so entities may reference each other in any order. A property may be typed narrower than its column, a branded id, and `f.references(() => User)` takes the key's type. Slightly stricter: `mappedBy` must name a relation or foreign key at compile time. Each field is written twice (builder and property), and it needs the TC39 decorator transform.
- **`defineEntity`**: the row type is derived, nothing written twice; no transform, so it fits projects on legacy decorators (NestJS, Angular), and it can be built at run time. Cheaper to type-check. A shared set of fields spreads into `fields`.

`uql-codemod` cannot convert one form into the other. Details: https://uql-orm.dev/entities/define-entity.md

### Decorators

```ts
import { Entity, f, Field, ManyToOne, OneToMany } from 'uql-orm';

@Entity()
export class User {
  @Field(
    f
      .uuid()
      .id()
      .onInsert(() => crypto.randomUUID()),
  )
  id?: string;

  @Field(f.string().unique())
  email!: string;

  @OneToMany(() => Post, { mappedBy: (post) => post.author })
  posts?: Post[];
}

@Entity()
export class Post {
  @Field(f.number().autoIncrement())
  id?: number;

  @Field(f.string().nullable())
  title?: string | null;

  @Field(f.references(() => User).nullable())
  authorId?: string | null;

  @ManyToOne(() => User, { references: (post) => post.authorId })
  author?: User;
}
```

- A column is a builder: `f.string()`, `f.text()`, `f.uuid()`, `f.number()`, `f.bigint()`, `f.decimal(precision?, scale?)`, `f.boolean()`, `f.date()`, `f.json(schema?)`, `f.jsonb(schema?)`, `f.vector(dimensions)`, `f.enum(values)`, `f.version()`, `f.column(type)` for any other SQL type uql names (`f.column('smallint')`, `f.column('date')` for a day with no time, `f.column('timestamptz')`), typed by its family, and `f.references(() => Target)` for a foreign key typed as the target's key. A type uql does not name is ``.columnType(sql`citext`)``. Only the methods a column's type takes exist: `.length()` is a string's, `.precision()` a number's or a date's. A builder is immutable, so `const money = f.decimal(12, 2)` is shared across fields, each chaining its own `.nullable()`.
- A column is NOT NULL unless `.nullable()`. Declare a NOT NULL property `!` (`email!: string`), and `?` what an insert may omit: nullable columns (`title?: string | null`), `.eager(false)` and computed fields, relations, and the version uql fills. A key the database generates is `@Field(f.number().autoIncrement()) id?: number` (`f.bigint().autoIncrement()` past 2^53); `.id()` alone generates nothing, so `f.number().id()` is a key the caller supplies and `@Field` refuses `?` on it, as on a `.references()` key. A NOT NULL field something fills (`.default()`, `.onInsert()`, a generated key) stays `!` when listed in the class's `[filledKey]?: 'id' | 'createdAt'`: inserts may omit it, reads always have it. MongoDB fills a text key declared `?` and `_id`. `insertOne`, `insertMany`, `saveOne`, `saveMany`, `upsertOne` and `upsertMany` resolve to a defined key, so no `!`. On SQL engines an insert leaving out a key nothing declared fills throws before writing. `defineEntity` works all of this out.
- `.default()` takes a value of the field's type, or SQL the database evaluates per row: `currentTimestamp`, `currentDate`, `currentTime`, `uuid` (not SQLite), `uuidv7` (Postgres 18+, MariaDB 11.7+), or ``sql`...` ``. A plain string is always text, `'CURRENT_TIMESTAMP'` included. A JSON column defaults to a value, `.default({})` or `.default(0)`, never its JSON text (`'{}'`, `'0'` are refused); any other string there is a JSON string.
- `Date` is an instant, stored in UTC to the millisecond. `f.decimal()` is exact text (`price?: string | null`); `f.number().precision(10).scale(2)` opts into a rounding JS number.
- A JSON column's property is `Json<T>`: `settings?: Json<{ theme?: string }> | null`. A plain object type reads as a relation, which `$where`, `$sort` and the update operators refuse.
- A relation decorator takes its target first, then its options, as `rel.*` does. `mappedBy` and `references` may be left out where only one member fits, and then the options too: `@OneToMany(() => Post)`. `@ManyToMany(() => Tag, { through: () => PostTag })` names the junction entity. `cascade: true` writes related rows with their row, in one transaction on SQL and, on MongoDB, inside one the caller opens; an update replaces a to-many's rows.
- A class inherits its base's fields, relations, hooks, filters, indexes, checks and triggers. A base of fields alone needs no `@Entity()`; one declaring entity options but no table is `@Entity({ abstract: true, ... }) abstract class`, which cannot be queried.
- Optimistic lock: `@Field(f.version())` with `[versionKey]?: 'version'` on the class. An update, and an upsert or save of a row that exists, must carry the version it read; a stale one throws `UqlOptimisticLockError`.
- Computed fields are `readonly`: ``@Computed((u) => f.string().as(sql`${u.first} || ' ' || ${u.last}`))``, `.stored()` for a generated column, or a relation aggregate, `@Computed((user) => user.posts.count())`.
- Indexes, checks, filters and triggers are `@Entity` options, each entry made by the helper the callback is handed. A partial index's predicate is a query: `indexes: (post, index) => [index([post.authorId], { where: { archived: { $ne: true } } })]`. A JSON path is indexed off the column's ref, `index([user.settings.theme])`: https://uql-orm.dev/entities/indexes.md
- Triggers run in the database: `triggers: (post, trigger) => [trigger({ on: 'afterUpdate', of: [post.status], run })]`, where `run` returns a body built from `insertInto`, `upsertInto`, `updateTable`, `deleteFrom` and `refuse(message)`. `on` is one event: a body several events share is one `run` passed to each entry. They skip entity filters and run no JavaScript: an insert fills an `.onInsert()` value or SQL, but an `insertInto` names every required column a callback fills (`.onInsert(() => crypto.randomUUID())`) where no database default does. MongoDB has none: https://uql-orm.dev/entities/triggers.md
- Hooks are methods with `this` bound to the payload: `@BeforeInsert()`, `@AfterInsert()`, and the same pairs for update, upsert and delete, plus `@AfterLoad()`. Changes to `this` in a before-hook are written. `upsert*` runs only the upsert pair, and `save*` the upsert pair for a row carrying its key. Each receives `{ querier, onCommit }`.
- **MongoDB:** a `f.number()` key left to the database is refused, since MongoDB only generates ObjectIds. Declare it a string, or give it an `.onInsert()` generator.

### defineEntity

```ts
import { defineEntity, f, sql } from 'uql-orm';
import { z } from 'zod';

const Settings = z.object({ theme: z.string(), bio: z.string().optional() });

export const Author = defineEntity({
  name: 'Author',
  fields: {
    id: f.number().autoIncrement(),
    name: f.string(),
    settings: f.json(Settings).nullable(),
  },
}).relations(
  (rel) => ({ books: () => rel.oneToMany(Book, { mappedBy: (book) => book.author }) }),
  (author) => ({ bookCount: () => author.books.count() }),
);
export interface Author extends InstanceType<typeof Author> {}

export const Book = defineEntity({
  name: 'Book',
  fields: {
    id: f.number().autoIncrement(),
    title: f.string(),
    stock: f.number().default(0),
    authorId: f.number(),
  },
})
  .computed((book) => ({ shout: f.string().as(sql`upper(${book.title})`) }))
  .indexes((book, index) => [index([book.title])])
  .relations((rel) => ({
    author: () => rel.manyToOne(Author, { references: (book) => book.authorId }),
  }));
```

- Columns are the same builders. No `!` or `?` to write: a `.nullable()` column reads `| null`, a default makes it optional on insert, `f.enum()` gives the literal union. A constructor's type argument narrows the column, a brand or a JSON payload with no runtime schema: `f.uuid<UserId>().id()`, `f.json<Settings>()`. It checks the type against the column and exists only in types; a default is written as that type. A filter then takes the branded type, and a foreign key to a branded key must carry the same brand, whether a relation or a decorated property declares it. Name its rows with an interface, `export interface Author extends InstanceType<typeof Author> {}`: hovers and errors then print `Author`, which a type alias expands.
- `defineEntity` takes `name` (the table derives from it), `table`, `schema`, `extends`, `abstract` and `fields`. Every other option is a section chained after it, each called at most once: `computed`, `indexes`, `checks`, `triggers`, `filters`, `policies`, `hooks`, then `relations` last; only `filters` and `policies` follow it, and of two reading through relations the one chained last may read them.
- A relation is a thunk, so entities pointing at each other can sit in any order and file. A foreign key is a plain field that a `manyToOne` names as `references`, checked against the target's key type. `relations`' second callback declares aggregate fields: aggregates over a to-many, or expressions mixing them with columns.
- A JSON column's payload is any Standard Schema (Zod, Valibot, ArkType), typed by its output. uql never runs it, so a write is not validated.
- A hook is a function of the row and the same second argument. Behaviour is a plain function of the row (`label(author: Author)`): a row reads back as a plain object, so a method would never be there.

### Filters, soft delete, tenants and policies

A filter is a named `$where` fragment applied to every read, update and delete of its entity, so never repeat it in a query. A policy is what must hold whatever a call asks: tenants and row-level security.

```ts
import { $context, Entity, explainPolicies, f, Field, withContext } from 'uql-orm';

declare module 'uql-orm' {
  interface UqlContext {
    tenantId?: number;
    userId?: string;
    role?: string;
  }
}

@Entity({
  filters: { active: { where: { status: 'active' }, default: false } },
  policies: [
    { allow: { ownerId: $context.userId }, check: { status: { $ne: 'void' } } },
    { allow: {}, ops: ['read'], when: { role: ['auditor', 'admin'] } },
  ],
})
export class Invoice {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.number().tenant()) companyId?: number;
  @Field(f.string()) ownerId!: string;
  @Field(f.string().nullable()) status?: string | null;
  @Field(f.date().nullable().softDelete()) deletedAt?: Date | null;
}

await withContext({ tenantId: 42, userId: 'u1' }, () => pool.findMany(Invoice, {}));
```

- A filter is on unless `default: false`. A `$where` naming its field wins over it. Per call, the options argument takes `{ filters: false }`, `{ filters: { softDelete: false } }` or `{ filters: { active: true } }`.
- `.softDelete()` on one field turns a delete into a stamp (`new Date()`, or the value or callback given), and registers a `softDelete` filter hiding stamped rows. `withDeleted()` as the options reads both; `restoreOneById` and `restoreMany` undo it; `{ hardDelete: true }` removes rows for good. A restore does not cascade.
- A filter's `where` may read the context as data, `{ authorId: $context.userId }`, and is skipped where the context lacks a key it reads; or it may be a function of the context `withContext(ctx, fn)` sets, which follows `await`, `Promise.all` and transactions but not emitters, timers or queues: wrap those callbacks with `captureContext()`.
- `.tenant()` on one column makes it the row's tenant, read off `$context.tenantId` (`.tenant($context.orgId)` names another, which must hold the column's type): every statement is held to it, and an insert leaving it out is given it.
- A policy is data: `{ allow: where }` or `{ must: where }`, beside `ops` (`'read'`, `'insert'`, `'update'`, `'delete'`, every one where unset), `check` (what a written row must hold, the `where` where unset), `when` (context keys at a value, or one of a list) and `name`. A row is reached when any `allow` holding the statement reaches it and every `must` holds. An entity declaring no `allow` is allowed every row its `must`s (and tenant) leave; one declaring some reaches no row in a statement none of them holds. An update or delete is held to the `read` ones too. `{}` reaches every row. A policy stated once as a constant serves every entity with the fields it names.
- `explainPolicies(Invoice, 'read')` answers the `where` the querier ANDs in under the ambient context (and `check` for a write): what to look at when a read reaches no row.
- `$context.tenantId` reads the context key in a predicate, typed by `UqlContext`: once it declares keys, a misspelled one, or one in `when`, does not compile; a relation is read like any `$where` (`{ allow: { members: { userId: $context.userId } } }`). A key the context lacks or holds null matches nothing, as SQL's NULL compares: no context, no rows.
- Policies hold every read, populate, relation filter and count, and every write: an insert gets each field a policy pins to one value (`companyId`), a write setting another is refused with `UqlSecurityError`, and a check the row alone cannot settle is read back in the write's transaction (MongoDB needs `transaction()` for one; D1 refuses it). Nothing per call turns a policy off: run trusted, cross-tenant work on a pool built with `{ policies: false }`.
- `{ policies: 'native' }` on a Postgres or CockroachDB pool has the database hold them: migrations install `CREATE POLICY` (RLS enabled and forced), each transaction binds the context with `set_config`, and raw SQL is held too. Connect it as a role that is no superuser and lacks `BYPASSRLS`; a statement under a context is refused otherwise. CockroachDB takes no relation in a native policy, and a Postgres insert must be readable by the context inserting it. https://uql-orm.dev/multi-tenancy.md

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

- Methods: `findMany`, `findOne`, `findOneById`, `findManyAndCount`, `findManyPage`, `findManyStream`, `count`, `estimatedCount`, `exists`, `aggregate`, `insertOne`, `insertMany`, `updateOneById`, `updateMany`, `saveOne`, `saveMany`, `upsertOne`, `upsertMany`, `deleteOneById`, `deleteMany`. Each takes the entity class first; on a querier, each taking a query also takes it as the query's `$entity`, so the whole call is JSON. Whether anything matches is `exists`, which stops at the first row, never `count(...) > 0`. Signatures: https://uql-orm.dev/querying/methods.md
- `$` marks the query language: clauses, operators, `$old`/`$new` in a trigger's predicate and `$context` reads. Field, relation and context key names never take it, and neither do a definition's or a call's options (`policies: [{ allow, ops, when }]`, `{ filters: false }`).
- Query keys: `$select`, `$where`, `$populate`, `$count`, `$distinct`, `$sort`, `$skip`, `$limit`, `$lock`. `$select: { password: false }` reads every field but `password`. `$count: { posts: true }` counts a to-many under `_count` without loading it.
- Results are narrowed to what the query selected and populated, at every depth. Reading an unselected field is a compile error. Name a shape with `QueryFindResult<User, 'id' | 'email'>`, or `QueryFindResult<User, typeof query>` for a query declared `as const satisfies Query<User>`. A function forwarding a query keeps the narrowing typed `<E extends object, const Q extends Query<E>>(entity: Type<E>, q: Captured<Query<E>, Q>): Promise<QueryFindResult<E, Q>[]>`.
- `$populate` loads relations in the same statement. Nothing is lazy: an unpopulated relation is absent. A populated to-many is always a list. A to-one is optional unless `$required: true`, which keeps only the parents that have one.
- `$sort` takes `'asc'`/`1`, `'desc'`/`-1`, or `'ascNullsLast'`, `'ascNullsFirst'`, `'descNullsFirst'`, `'descNullsLast'`.
- `findManyPage(User, { $sort: { createdAt: -1, id: 1 }, $limit: 20, $after })` pages by cursor, so page 1,000 costs what page 1 does, and returns `{ items, startCursor, endCursor, hasNextPage, hasPrevPage }`. `$sort` must end in the key or a unique NOT NULL field; no `$skip`.
- `$lock: true` locks the rows a read returns, inside an open transaction; `{ $wait: 'skip' | 'nowait' }` says what to do about a row someone else holds. The SQLite family and MongoDB refuse it.

### `$where`

- `$where` takes a value for equality, a list as an implicit `$in`, or an operator map: `$eq`, `$ne`, `$lt`, `$lte`, `$gt`, `$gte`, `$between`, `$in`, `$nin`, `$isNull`, `$isNotNull`. Combine with `$and`, `$or`, `$not`, `$nor`. A field takes only the operators its type allows.
- Text: `$like`, `$startsWith`, `$endsWith`, `$includes`, each with a case-insensitive `i` form (`$ilike`, `$istartsWith`, ...). `$like` reads `%`, `_` and `\` the same on every engine; the other three take their text literally. `$regex` is case-sensitive unless the pattern opens with `(?i)`.
- Arrays and JSON: `$all: ['a', 'b']`, `$size: 3` or `{ $gte: 2 }`, `$elemMatch: { city: 'NYC', zip: { $startsWith: '10' } }`. A JSON path filters like a field: `{ 'settings.billing.plan': 'pro' }`.
- A relation key keeps the parents with a matching related row, as an `EXISTS`, never duplicating them: `{ posts: { title: { $iincludes: 'orm' } } }`, or by count: `{ posts: { $size: { $gte: 5 } } }`. For a subquery no relation covers, `$exists` / `$nexists` take a `sql` fragment.
- Full-text: `$where: { $text: { $value: 'wireless keyboard' } }` searches the entity's fulltext index; `$sort: { $text: 'desc' }` ranks by relevance.
- Vectors: `$sort: { embedding: { $vector: v } }` with a `$limit` returns the nearest; `$where: { embedding: { $near: { $vector: v, $lt: 0.35 } } }` keeps only close rows; `$candidates` tunes ANN recall.
- An operator compares a field with another column of the row wherever it takes a value: `const rate = refs(Rate); pool.findMany(Rate, { $where: { effectiveTo: { $gt: rate.effectiveFrom } } })`. A check's refs work the same. A JSON path compared with a ref reads as that column's type. A ref of another entity than the one queried is refused: in raw SQL, read it off its own alias, `refs(Other, 'o')`.
- An `undefined` anywhere in `$where` throws. Leave the key out to skip the filter (`...(email && { email })`), or name `null`.
- On SQL, `$ne`, `$nin`, `$not` and `$nor` drop NULL rows, where MongoDB keeps them. To keep them, name NULL: `{ $or: [{ col: { $ne: 'a' } }, { col: null }] }`.

### Writes

- Without options, inserts and upserts resolve to ids, updates and deletes to a count. A last argument `{ returning: { id: true } }` resolves to those rows instead, `{ returning: true }` to every field a read returns.
- `upsertOne(Entity, { $conflict: { email: true }, $where?, $update? }, row)`: a conflicting row matching `$where` takes `$update` (an update payload; `{}` keeps it as it is), else the payload but keeping its own key; one not matching stays as it is. SQL in `$update` reads the found row through `refs(Entity)`, no alias: ``{ uses: sql`${query.uses} + 1` }`` with `const query = refs(SearchQuery)`. `upsertInto` in a trigger takes the same query. On MySQL and MariaDB, a `$where` may read only one column the update sets.
- `updateMany` and `deleteMany` that name no rows (no `$where` holding a value, no `$limit`) throw. Pass `{ unfiltered: true }` to mean the whole table.
- Update operators: `{ stock: { $inc: -1 } }` or `$mul`, with NULL counted as 0. A guard in `$where` (`stock: { $gte: 1 }`) makes a decrement race-safe. JSON fields take `$pull`, `$set`, `$push`, `$addToSet`, then `$unset`, applied in that order; `$set` and `$unset` take dotted paths and create parents: `settings: { $set: { 'billing.plan': 'pro' } }`.

### Raw SQL and errors

- ``pool.all`SELECT ... WHERE id = ${id}` `` for a `SELECT`, ``pool.run`...` `` for a write. Interpolated values bind: a scalar or `null`, never `undefined` or a plain object; an array binds as one array value, on the Postgres family alone (`= ANY(${ids})`), DDL included. A list for `IN` is `sql.join(values)`, one bound value each, on every engine. `sql` builds a fragment, `sql.join(fragments, ' AND ')` joins them, and `sql.text(s)` runs trusted SQL held in a string: never user input.
- A condition no operator expresses is a `sql` fragment beside the others, naming columns through `refs()`, never by string: ``const item = refs(Item); $where: { $and: [{ companyId: 1 }, sql`${item.price} * ${item.stock} > ${10000}`] }``. SQL databases only.
- SQL reading another table names it with `tableOf`, its columns off refs read under an alias, so a rename reaches them: ``const o = refs(Order, 'o'); sql`(SELECT ${o.state} FROM ${tableOf(o)} WHERE ${o.checkoutId} = ${checkout.id} LIMIT 1)` ``. Two aliases read one table twice. For an entity declared later, a computed field's SQL included, pass an arrow: `refs(() => Order, 'o')`, `tableOf(refs(() => Order))`. `aliasOf(o)` renders the alias alone, for SQL reading the whole row (`pdb.score(${aliasOf(o)})`) or naming a derived table (`) ${aliasOf(o)} ON TRUE`). A name the statement makes up, read twice, is `sql.id('reason')`.
- `queryErrorKind(err)` names a failure: `uniqueViolation`, `foreignKeyViolation`, `notNullViolation`, `checkViolation`, `optimisticLock`, `retryable`, `usage`, `security`. Catch by kind, not by driver code.

## Aggregates

Compute in SQL, not in code: loading rows to dedupe, count or sum them in JavaScript costs a round trip and every row.

```ts
// Distinct values: a $group with no $select returns each once.
const titles = await pool.aggregate(Post, { $group: { title: true }, $sort: { title: 1 } });

// Tallies per group, in one statement.
const counts = await pool.aggregate(Post, {
  $group: { authorId: true },
  $select: { distinctTitles: { $countDistinct: { title: true } } },
});
```

- `$select` takes `$count` (`'*'` or a field), `$countDistinct`, `$sum`, `$avg`, `$min` and `$max`. Over no rows a count is `0` and the others `null`.
- The query's `$where` filters rows before grouping. An operator's own `$where` filters only what it reads, pivoting rows into columns in one query: `{ $count: '*', $where: { published: true } }`.
- `$having` and `$sort` name a grouped column or a `$select` alias.
- A `$group` key can reach a to-one relation's field (`{ orderId: { transaction: { orderId: true } } }`), never a to-many's.
- A per-row count belongs on the entity as a computed field, or on a read as `$count`, not in an aggregate. Details: https://uql-orm.dev/querying/aggregate.md

## Connections and transactions

Every method is on the pool and on a querier. A pool call takes a connection for that call. For several operations on one connection, or atomically:

```ts
await pool.transaction(async (querier) => {
  const userId = await querier.insertOne(User, { email: 'ada@uql-orm.dev' });
  await querier.insertOne(Post, { title: 'Hello', authorId: userId });
});
```

- The callback commits when it returns and rolls back when it throws. Inside it, `pool` calls run on its querier. A nested `transaction()` is a savepoint; MongoDB refuses it.
- `querier.onCommit(fn)` runs `fn` after the outermost commit, never on rollback.
- A transaction opened in one place and ended in another uses `beginTransaction`, `commitTransaction` and `rollbackTransaction`. A querier from `pool.getQuerier()` is yours to release: bind it with `await using`.
- A `findManyStream` holds its querier until the loop ends, refusing other statements meanwhile: run them after the loop, or on another connection.

## Serving to a client

A query is JSON, so a browser sends it as it is and the server checks it against what each entity exposes.

```ts
import { createApi, toFetchHandler } from 'uql-orm/http';

const api = createApi<Request>({
  pool,
  include: [Post, User],
  contextOf: async (req) => ({ tenantId: (await getSession(req))?.tenantId }), // a verified session or JWT
});

export const handler = toFetchHandler(api); // on a catch-all under /api/v1
```

- Nothing is exposed by default: defining an entity serves nothing, and `include` is required, its entities the only ones a call reaches, through a relation too. Mount the API under a versioned base: `toFetchHandler(api)` for any fetch runtime (Hono, Next.js, Bun, Workers), `app.use('/api/v1', toExpress(api))` from `uql-orm/express`, or `toRequestHandler(api)` for any other framework. Inside a tRPC or oRPC procedure call `api.call(input, ctx)`, which checks the call itself; `.input(parseWireCall)` types it.
- The wire is `{base}/:entity/:op` (`/api/v1/user/findMany`), the entity's kebab-cased class name and a client method: a read is `GET ?q=<call as JSON>` (or a JSON body by `POST` or `QUERY`: `httpTransport(url, { readMethod: 'POST' })`), a write a JSON `POST`. A success answers `{ data }`, a failure `{ error: { message, status, kind, path } }`.
- What a client may do is the definition's `wire`, every operation where unset. An entity's (`@Entity({ wire: ['read', 'update'] })`, `defineEntity({ wire })`) lists what it takes of `'read'`, `'insert'`, `'update'`, `'delete'`, a subclass declaring none taking its base's; `wire: false` keeps it off every API, and `createApi` refuses one in `include`. A member's: `f.string().wire(false)` hides a field, `.wire(['read'])` makes it read-only, `.wire(['insert'])` write-once; a relation takes `wire` in its options (`rel.oneToMany(Session, { mappedBy, wire: false })`, `@OneToMany(() => Session, { mappedBy, wire: false })`). It holds wherever the entity is reached, through any relation. A write the querier would drop, to a computed field or an update of an `updatable(false)` one, is refused instead; a save may insert, so it takes the latter.
- `read` covers every clause naming the member (`$select`, `$where`, `$sort`, `$count`, `$populate`), and a read with no `$select` leaves out what it may not read. `.eager(false)` is no guard, since a client's `$select` still reads it: hide a secret with `.wire(false)`.
- A middleware is `(call, context, next) => next(call)`, run after the call is checked: reshape the call before `next`, or what `next` resolves to after it. The API's `use` runs on every call, and `serve(Entity, { use })` in `include` on that entity's alone, typed by it (`call.op === 'insertOne'` types `call.payload` as a row). Refuse a client with `throw new UqlRequestError('unauthorized', 401)` from `uql-orm`; any other error answers generically by its kind, or `500`.
- Scope tenants with a policy and `contextOf`, never with a middleware adding to `$where`. Without `contextOf` a call keeps its caller's context. On NestJS, `UqlModule.forRoot({ pool, contextOf })` does the same for your own routes.
- The API serves one entity per call: no `aggregate`, upsert, stream or transaction. Write your own routes for those beside it; `toFetchHandler` answers `404` and `toExpress` falls through to `next()` on paths it does not serve.
- The client is `createClientQuerier(httpTransport('/api/v1'))` from `uql-orm/browser`, or `createClientQuerier((call) => trpc.uql.mutate(call))` over any transport. It has the pool's find, `count`, `exists`, insert, save, update and delete methods and answers what they answer (rows, not `{ data }`), reading each row back by its entity, which must be registered (importing it does): a `Date` field is a `Date` and a `bigint` exact, so a cache persisting rows needs a serializer. `httpTransport` rejects with a `RequestError` carrying `status`, `kind` and `path`.
- For TanStack Query, `const uql = createQueryOptions(transport)` and `useQuery(uql((db) => db.findMany(User, q)))`: the key is the call the read makes (`['uql', 'user', 'findMany', { query }]`), so it cannot drift from the fetch, and `uql.key(User)` invalidates every read of `User`.
- A server bundle that minifies class names must keep them, or pass the same `entityPath` to `createApi` and `createClientQuerier`.

## Migrations

`npx uql-migrate` reads `uql.config.ts` (`bun --bun uql-migrate` on Bun):

- `sync`: applies what the entities imply. Development only. `sync --dry-run` prints only the SQL, for another tool to apply.
- `generate:entities`: writes the diff as a migration file to review. A renamed column is a drop and an add, unless a naming strategy maps it or you write `renameColumn(table, from, to)`. It refuses a required column with no default on a table holding rows.
- `up` and `down`: each migration in its own transaction, under a lock so concurrent instances run it once. From code: `await new Migrator(pool, { migrationsPath }).up()` before the app starts.
- `generate:from-db`: writes entity classes from an existing database.
- `drift:check`: fails when the database no longer matches the entities.

Upgrading uql itself: `npx uql-codemod --dry-run`, then `npx uql-codemod`, which rewrites what it can and reports the rest. Breaking changes: https://uql-orm.dev/upgrade-guide.md

## Before you finish

- Mail, webhooks and queued jobs run from `onCommit`, never from an after-hook or mid-transaction.
- Several writes that must land together run in one `pool.transaction(...)`; on MongoDB, so does an upsert with an `$update` or `$where`, and an `updateMany` or `deleteMany` that cascades or runs hooks.

## Where to read more

- Operators and per-dialect SQL: https://uql-orm.dev/querying/comparison-operators.md
- Relations, relation filters and deep `$populate`: https://uql-orm.dev/querying/relations.md
- JSON paths and operators: https://uql-orm.dev/querying/json.md
- Full-text and vector search: https://uql-orm.dev/querying/full-text.md, https://uql-orm.dev/querying/semantic-search.md
- Computed fields: https://uql-orm.dev/entities/computed-fields.md
- Serving queries to a client: https://uql-orm.dev/http.md, https://uql-orm.dev/browser.md
- Coming from Prisma, Drizzle, TypeORM, MikroORM or Mongoose: https://uql-orm.dev/switching-to-uql.md
