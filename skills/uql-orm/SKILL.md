---
name: uql-orm
description: >
  Write code with UQL (the uql-orm package), the TypeScript ORM whose queries are plain JSON objects,
  on PostgreSQL, MySQL, MariaDB, SQLite, CockroachDB, SQL Server, MongoDB, Turso, Neon, D1 and PGlite.
  Use when a project imports uql-orm, or when defining entities, triggers or filters (soft delete, multi-tenancy),
  querying, populating relations, writing transactions, raw SQL or migrations with it. UQL is not Prisma, Drizzle, TypeORM or MikroORM:
  their APIs do not carry over.
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

- **Decorators**: a named class type, and column-level foreign keys (`f.references`), so entities may reference each other in any order. Slightly stricter: a property may be typed narrower than its column (a branded id), and `mappedBy` must name a relation or foreign key at compile time. Each field is written twice (builder and property), and it needs the TC39 decorator transform.
- **`defineEntity`**: the row type is derived, nothing written twice; no transform, so it fits projects on legacy decorators (NestJS, Angular), and it can be built at run time. Cheaper to type-check. Relations come last, and the row type needs a `type X = InstanceType<typeof X>` alias. A shared set of fields spreads into `fields`.

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

  @OneToMany({ entity: () => Post, mappedBy: (post) => post.author })
  posts?: Post[];
}

@Entity()
export class Post {
  @Field(f.number().id())
  id?: number;

  @Field(f.string().nullable())
  title?: string | null;

  @Field(f.references(() => User).nullable())
  authorId?: string | null;

  @ManyToOne({ entity: () => User, references: (post) => post.authorId })
  author?: User;
}
```

- A column is a builder: `f.string()`, `f.text()`, `f.uuid()`, `f.number()`, `f.bigint()`, `f.decimal(precision?, scale?)`, `f.boolean()`, `f.date()`, `f.json(schema?)`, `f.jsonb(schema?)`, `f.vector(dimensions)`, `f.enum(values)`, `f.version()`, `f.column(type)` for any other type, and `f.references(() => Target)` for a foreign key typed as the target's key. Only the methods a column's type takes exist: `.length()` is a string's, `.precision()` a number's or a date's.
- A column is NOT NULL unless `.nullable()`. Declare a NOT NULL property `!` (`email!: string`), and `?` what an insert may omit: nullable columns (`title?: string | null`), `.eager(false)` and computed fields, relations, and the single-column key and version uql fills. A NOT NULL field a default fills (`.default()`, `.onInsert()`) stays `!` and is listed in the class's `[filledKey]?: 'stock' | 'createdAt'`: inserts may omit it, reads always have it.
- `.default()` takes a value of the field's type, or SQL the database evaluates per row: `currentTimestamp`, `currentDate`, `currentTime`, `uuid` (not SQLite), `uuidv7` (Postgres 18+, MariaDB 11.7+), or ``sql`...` ``. A plain string is always text, `'CURRENT_TIMESTAMP'` included. A JSON column defaults to a value, `.default({})` or `.default(0)`, never its JSON text (`'{}'`, `'0'` are refused); any other string there is a JSON string.
- `Date` is an instant, stored in UTC to the millisecond on every engine. `f.decimal()` is exact text (`price?: string | null`); `f.number().precision(10).scale(2)` opts into a rounding JS number.
- A JSON column's property is `Json<T>`: `settings?: Json<{ theme?: string }> | null`. A plain object type reads as a relation, which `$where`, `$sort` and the update operators refuse.
- `mappedBy` and `references` may be left out where only one member fits. `@ManyToMany({ entity: () => Tag, through: () => PostTag })` names the junction entity. `cascade: true` writes related rows with their row, in one transaction on SQL and, on MongoDB, inside one the caller opens; an update replaces a to-many's rows.
- A class inherits its base's fields, relations, hooks, filters, indexes, checks and triggers. A base of fields alone needs no `@Entity()`; one declaring entity options but no table is `@Entity({ abstract: true, ... }) abstract class`, which cannot be queried.
- Optimistic lock: `@Field(f.version())` with `[versionKey]?: 'version'` on the class. An update, and an upsert or save of a row that exists, must carry the version it read; a stale one throws `UqlOptimisticLockError`.
- Computed fields are `readonly`: ``@Computed((u) => f.string().as(sql`${u.first} || ' ' || ${u.last}`))``, `.stored()` for a generated column, or a relation aggregate, `@Computed((user) => user.posts.count())`.
- Indexes, checks, filters and triggers are `@Entity` options, each entry made by the helper the callback is handed. A partial index's predicate is a query: `indexes: (post, index) => [index([post.authorId], { where: { archived: { $ne: true } } })]`. A JSON path is indexed off the column's ref, `index([user.settings.theme])`: https://uql-orm.dev/entities/indexes.md
- Triggers run in the database: `triggers: (post, trigger) => [trigger({ on: 'afterUpdate', of: [post.status], run })]`, where `run` returns a body built from `insertInto`, `upsertInto`, `updateTable`, `deleteFrom` and `refuse(message)`. They skip entity filters and run no JavaScript: an insert fills an `.onInsert()` value or SQL, but an `insertInto` names every required column a callback fills (`.onInsert(() => crypto.randomUUID())`) where no database default does. MongoDB has none: https://uql-orm.dev/entities/triggers.md
- Hooks are methods with `this` bound to the payload: `@BeforeInsert()`, `@AfterInsert()`, and the same pairs for update, upsert and delete, plus `@AfterLoad()`. Changes to `this` in a before-hook are written. `upsert*` runs only the upsert pair, and `save*` the upsert pair for a row carrying its key. Each receives `{ querier, onCommit }`: send mail from `onCommit`, never straight from an after-hook.
- **MongoDB:** a `f.number()` key left to the database is refused, since MongoDB only generates ObjectIds. Declare it a string, or give it an `.onInsert()` generator.

### defineEntity

```ts
import { defineEntity, f, sql } from 'uql-orm';
import { z } from 'zod';

const Settings = z.object({ theme: z.string(), bio: z.string().optional() });

export const Author = defineEntity({
  name: 'Author',
  fields: {
    id: f.number().id(),
    name: f.string(),
    settings: f.json(Settings).nullable(),
  },
}).relations(
  (rel) => ({ books: () => rel.oneToMany(Book, { mappedBy: (book) => book.author }) }),
  (author) => ({ bookCount: () => author.books.count() }),
);
export type Author = InstanceType<typeof Author>;

export const Book = defineEntity({
  name: 'Book',
  fields: {
    id: f.number().id(),
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

- Columns are the same builders. No `!`, `?` or brands to write: a `.nullable()` column reads `| null`, a default makes it optional on insert, `f.enum()` gives the literal union.
- `defineEntity` takes `name` (the table derives from it), `table`, `schema`, `extends`, `abstract` and `fields`. Every other option is a section chained after it, each called at most once: `computed`, `indexes`, `checks`, `triggers`, `filters`, `hooks`, then `relations` last; only a `filters` reading through relations follows it.
- A relation is a thunk, so entities pointing at each other can sit in any order and file. A foreign key is a plain field that a `manyToOne` names as `references`, checked against the target's key type. `relations`' second callback declares aggregate fields: aggregates over a to-many, or expressions mixing them with columns.
- A JSON column's payload is any Standard Schema (Zod, Valibot, ArkType), typed by its output. uql never runs it, so a write is not validated.
- A hook is a function of the row and `{ querier, onCommit }`. Behaviour is a plain function of the row (`label(author: Author)`): a row reads back as a plain object, so a method would never be there.

### Filters, soft delete and tenants

A filter is a named `$where` fragment applied to every read, update and delete of its entity, so never repeat it in a query.

```ts
import { Entity, f, Field, withContext } from 'uql-orm';

declare module 'uql-orm' {
  interface UqlContext {
    tenantId?: number;
  }
}

@Entity({
  filters: {
    active: { where: { status: 'active' }, default: false },
    tenant: { where: (ctx) => (ctx?.tenantId != null ? { companyId: ctx.tenantId } : undefined), security: true },
  },
})
export class Invoice {
  @Field(f.number().id()) id?: number;
  @Field(f.number()) companyId!: number;
  @Field(f.string().nullable()) status?: string | null;
  @Field(f.date().nullable().softDelete()) deletedAt?: Date | null;
}

await withContext({ tenantId: 42 }, () => pool.findMany(Invoice, {}));
```

- A filter is on unless `default: false`. A `$where` naming its field wins over it. Per call, the options argument takes `{ filters: false }`, `{ filters: { softDelete: false } }` or `{ filters: { active: true } }`.
- `.softDelete()` on one field turns a delete into a stamp (`new Date()`, or the value or callback given), and registers a `softDelete` filter hiding stamped rows. `withDeleted()` as the options reads both; `restoreOneById` and `restoreMany` undo it; `{ hardDelete: true }` removes rows for good. A restore does not cascade.
- A `where` may be a function of the context `withContext(ctx, fn)` sets, which follows `await`, `Promise.all` and transactions but not emitters, timers or queues: wrap those callbacks with `captureContext()`. Its keys are typed by augmenting `UqlContext`, as above.
- `security: true` makes a filter always apply, ignore bypasses, AND-merge with any `$where`, and throw `UqlSecurityError` when `where` returns `undefined`. It scopes writes too, so new rows need no tenant set by hand. For a trusted cross-tenant job, give `where` a branch returning `{}` (`ctx?.system ? {} : ...`) and run it under `withContext({ system: true }, fn)`: https://uql-orm.dev/multi-tenancy.md

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

- Methods: `findMany`, `findOne`, `findOneById`, `findManyAndCount`, `findManyPage`, `findManyStream`, `count`, `exists`, `aggregate`, `insertOne`, `insertMany`, `updateOneById`, `updateMany`, `saveOne`, `saveMany`, `upsertOne`, `upsertMany`, `deleteOneById`, `deleteMany`. Each takes the entity class first, or the query's `$entity`. Signatures: https://uql-orm.dev/querying/methods.md
- Query keys: `$select`, `$where`, `$populate`, `$count`, `$distinct`, `$sort`, `$skip`, `$limit`, `$lock`. `$select: { password: false }` reads every field but `password`. `$count: { posts: true }` counts a to-many under `_count` without loading it.
- Results are narrowed to what the query selected and populated, at every depth. Reading an unselected field is a compile error. Name a shape with `QueryFindResult<User, 'id' | 'email'>`, or `QueryFindResult<User, typeof query>` for a query declared `as const satisfies Query<User>`. A function forwarding a query keeps the narrowing typed `<E extends object, const Q extends Query<E>>(entity: Type<E>, q: Captured<Query<E>, Q>): Promise<QueryFindResult<E, Q>[]>`.
- `$populate` loads relations in the same statement. Nothing is lazy: an unpopulated relation is absent. A populated to-many is always a list. A to-one is optional unless `$required: true`, which keeps only the parents that have one.
- `$sort` takes `'asc'`/`1`, `'desc'`/`-1`, or `'ascNullsLast'`, `'ascNullsFirst'`, `'descNullsFirst'`, `'descNullsLast'`, which behave the same on every engine.
- `findManyPage(User, { $sort: { createdAt: -1, id: 1 }, $limit: 20, $after })` pages by cursor, so page 1,000 costs what page 1 does, and returns `{ items, startCursor, endCursor, hasNextPage, hasPrevPage }`. `$sort` must end in the key or a unique NOT NULL field; no `$skip`.
- `$lock: true` locks the rows a read returns, inside an open transaction; `{ $wait: 'skip' | 'nowait' }` says what to do about a row someone else holds. The SQLite family and MongoDB refuse it.

### `$where`

- `$where` takes a value for equality, a list as an implicit `$in`, or an operator map: `$eq`, `$ne`, `$lt`, `$lte`, `$gt`, `$gte`, `$between`, `$in`, `$nin`, `$isNull`, `$isNotNull`, `$not`. Combine with `$and`, `$or`, `$not`, `$nor`. A field takes only the operators its type allows.
- Text: `$like`, `$startsWith`, `$endsWith`, `$includes`, each with a case-insensitive `i` form (`$ilike`, `$istartsWith`, ...). `$like` reads `%`, `_` and `\` the same on every engine; the other three take their text literally. `$regex` is case-sensitive unless the pattern opens with `(?i)`.
- Arrays and JSON: `$all: ['a', 'b']`, `$size: 3` or `{ $gte: 2 }`, `$elemMatch: { city: 'NYC', zip: { $startsWith: '10' } }`. A JSON path filters like a field: `{ 'settings.billing.plan': 'pro' }`.
- A relation key keeps the parents with a matching related row, as an `EXISTS`, never duplicating them: `{ posts: { title: { $iincludes: 'orm' } } }`, or by count: `{ posts: { $size: { $gte: 5 } } }`. For a subquery no relation covers, `$exists` / `$nexists` take a `sql` fragment.
- Full-text: `$where: { $text: { $value: 'wireless keyboard' } }` searches the entity's fulltext index; `$sort: { $text: 'desc' }` ranks by relevance.
- Vectors: `$sort: { embedding: { $vector: v } }` with a `$limit` returns the nearest; `$where: { embedding: { $near: { $vector: v, $lt: 0.35 } } }` keeps only close rows; `$candidates` tunes ANN recall.
- An `undefined` anywhere in `$where` throws. Leave the key out to skip the filter (`...(email && { email })`), or name `null`.
- On SQL, `$ne`, `$nin`, `$not` and `$nor` drop NULL rows, where MongoDB keeps them. To keep them, name NULL: `{ $or: [{ col: { $ne: 'a' } }, { col: null }] }`.

### Writes

- Without options, inserts and upserts resolve to ids, updates and deletes to a count. A last argument `{ returning: { id: true } }` resolves to those rows instead.
- `upsertOne(Entity, { $conflict: { email: true }, $where? }, row, update?)`: a conflicting row matching `$where` takes `update` (an update payload), else the payload but keeping its own key; one not matching stays as it is. `upsertInto` in a trigger takes the same query. On MySQL and MariaDB, a `$where` may read only one column the update sets.
- `updateMany` and `deleteMany` that name no rows (no `$where` holding a value, no `$limit`) throw. Pass `{ unfiltered: true }` to mean the whole table.
- Update operators: `{ stock: { $inc: -1 } }` or `$mul`, with NULL counted as 0. A guard in `$where` (`stock: { $gte: 1 }`) makes a decrement race-safe. JSON fields take `$pull`, `$set`, `$push`, `$addToSet`, then `$unset`, applied in that order; `$set` and `$unset` take dotted paths and create parents: `settings: { $set: { 'billing.plan': 'pro' } }`.

### Raw SQL and errors

- ``pool.all`SELECT ... WHERE id = ${id}` `` for a `SELECT`, ``pool.run`...` `` for a write. Interpolated values bind: a scalar, `null` or a list, never `undefined` or a plain object. `sql` builds a fragment, `sql.join(fragments, ' AND ')` joins them, and `sql.text(s)` runs trusted SQL held in a string: never user input.
- An operator compares a field with another column through its ref, wherever it takes a value: `{ effectiveTo: { $gt: rate.effectiveFrom } }` off `refs(Rate)` or a check's refs, `$between`, `$in` and `$ne` alike, on every engine, MongoDB included. A JSON path compared with one reads as that column's type. A ref names a column of the entity in scope: one of another entity is refused, and reads off its own alias, `refs(Other, 'o')`.
- A condition no operator expresses is a `sql` fragment beside the others, naming columns through `refs()`, never by string: ``const item = refs(Item); $where: { $and: [{ companyId: 1 }, sql`${item.price} * ${item.stock} > ${10000}`] }``. SQL databases only.
- SQL reading another table names it with `tableOf`, its columns off refs read under an alias, so a rename reaches them: ``const o = refs(Order, 'o'); sql`(SELECT ${o.state} FROM ${tableOf(o)} WHERE ${o.checkoutId} = ${checkout.id} LIMIT 1)` ``. Two aliases read one table twice.
- `queryErrorKind(err)` names a failure the same on every engine: `uniqueViolation`, `foreignKeyViolation`, `notNullViolation`, `checkViolation`, `optimisticLock`, `retryable`, `usage`, `security`. Catch by kind, not by driver code.

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
- `querier.onCommit(fn)` runs `fn` after the outermost commit, never on rollback: use it for mail and queued jobs.
- A transaction opened in one place and ended in another uses `beginTransaction`, `commitTransaction` and `rollbackTransaction`. A querier from `pool.getQuerier()` is yours to release: bind it with `await using`.
- A `findManyStream` holds its querier until the loop ends, refusing other statements meanwhile: run them after the loop, or on another connection.

## Migrations

`npx uql-migrate` reads `uql.config.ts` (`bun --bun uql-migrate` on Bun):

- `sync`: applies what the entities imply. Development only. `sync --dry-run` prints only the SQL, for another tool to apply.
- `generate:entities`: writes the diff as a migration file to review. A renamed column is a drop and an add, unless a naming strategy maps it or you write `renameColumn(table, from, to)`. It refuses a required column with no default on a table holding rows.
- `up` and `down`: each migration in its own transaction, under a lock so concurrent instances run it once. From code: `await new Migrator(pool, { migrationsPath }).up()` before the app starts.
- `generate:from-db`: writes entity classes from an existing database.
- `drift:check`: fails when the database no longer matches the entities.

Upgrading uql itself: `npx uql-codemod --dry-run`, then `npx uql-codemod`, which rewrites what it can and reports the rest. Breaking changes: https://uql-orm.dev/upgrade-guide.md

## Where to read more

- Operators and per-dialect SQL: https://uql-orm.dev/querying/comparison-operators.md
- Relations, relation filters and deep `$populate`: https://uql-orm.dev/querying/relations.md
- JSON paths and operators: https://uql-orm.dev/querying/json.md
- Full-text and vector search: https://uql-orm.dev/querying/full-text.md, https://uql-orm.dev/querying/semantic-search.md
- Computed fields: https://uql-orm.dev/entities/computed-fields.md
- Coming from Prisma, Drizzle, TypeORM, MikroORM or Mongoose: https://uql-orm.dev/switching-to-uql.md
