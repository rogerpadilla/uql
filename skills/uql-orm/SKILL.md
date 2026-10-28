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

An entity is a decorated class, or declared as data with `defineEntity`, its row type derived. A query is a JSON object checked key by key against the entity, and it runs the same on every supported database. There is no schema file, no generated client and no query builder.

Full docs are Markdown: the index at https://uql-orm.dev/llms.txt, and each page at its URL plus `.md`. Read the page for the task before guessing an option.

## Setup

```sh
npm install uql-orm pg   # or mysql2, mariadb, better-sqlite3, mongodb, @libsql/client, ...
```

ESM only. Needs Node 22.18+, Bun or an edge runtime, and TypeScript 5.7+.

Decorators are TC39 standard. Never enable `experimentalDecorators` or `emitDecoratorMetadata`, and never import `reflect-metadata`. A project on legacy decorators (NestJS, Angular) keeps its config and defines entities with `defineEntity`: https://uql-orm.dev/entities/define-entity.md

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

- A column is a builder: `f.string()`, `f.text()`, `f.uuid()`, `f.number()`, `f.bigint()`, `f.decimal()`, `f.decimal(precision)`, `f.decimal(precision, scale)`, `f.boolean()`, `f.date()`, `f.json(schema?)`, `f.jsonb(schema?)`, `f.vector(dimensions)`, `f.enum(values)`, `f.version()`, `f.column(type)` for any other column type, and `f.references(() => Target)` for a foreign key, which takes the target's key type. Only the methods a column's type takes exist: `.length()` is a string's, `.precision()` a number's or a date's. A bound holds in either order around `.columnType('char')`, but not around a `sql` type, which carries its own.
- A column is NOT NULL unless `.nullable()`; its property then admits `null` (`title?: string | null`).
- A JSON column's property is `Json<T>`, where `T` is the payload: `settings?: Json<{ theme?: string }> | null`, or `Json<z.infer<typeof Settings>>` for a schema. A plain object type reads as a relation, and `$where`, `$sort` and the update operators refuse it.
- Declare a NOT NULL column with `!` (`email!: string`). Declare `?` for anything else an insert may omit: nullable columns, `.eager(false)` fields, and relations. A computed field is present on a default read, so it is not optional. uql fills a single-column key and a version.
- A NOT NULL field a default fills (`.default()`, `.onInsert()`) is `!` and listed in the class's `[filledKey]?: 'stock' | 'createdAt'`: inserts may omit it, reads always have it.
- `.default()` takes a value of the field's type, or SQL the database evaluates per row: `currentTimestamp`, `currentDate`, `currentTime`, `uuid` (not SQLite), `uuidv7` (Postgres 18+, MariaDB 11.7+), or ``sql`...` ``. A plain string is always text, `'CURRENT_TIMESTAMP'` included.
- A class inherits its base's fields, relations, hooks, filters, indexes, checks and triggers. A base of fields alone needs no `@Entity()`; one declaring indexes, filters, checks or triggers but no table is `@Entity({ abstract: true, ... }) abstract class`, or `abstract: true` in `defineEntity`. A query or write on one does not compile: query the entities extending it.
- `Date` is an instant, stored in UTC to the millisecond on every engine. `f.decimal()` is exact text (`price?: string | null`). `f.number().precision(10).scale(2)` opts into a rounding JS number.
- Members are named by callbacks, never strings: `mappedBy: (post) => post.author`, `references: (post) => post.authorId`. Either may be left out where only one member fits: a decorated many-to-one's one foreign key to its target, a one-to-many's one many-to-one pointing back.
- `@ManyToMany({ entity: () => Tag, through: () => PostTag })` names the junction entity. `cascade: true` writes related rows in the same transaction; an update replaces a to-many's rows.
- **MongoDB:** a key declared `f.number()` and left to the database is refused, since MongoDB only generates ObjectIds. Declare the key a string, or give it an `.onInsert()` generator.
- Optimistic lock: `@Field(f.version())` with `[versionKey]?: 'version'` on the class. An update must carry the version it read. A stale one throws `UqlOptimisticLockError` (kind `optimisticLock`, HTTP 409).
- Computed fields are `readonly` and read in any query that names them. As SQL over the row, ``@Computed((u) => f.string().as(sql`${u.first} || ' ' || ${u.last}`))``, `.stored()` making a generated column, or as a relation aggregate: `@Computed((user) => user.resources.count())`.
- Indexes, checks, filters and triggers are `@Entity` options, each entry made by the helper the callback is handed. Partial index: `@Entity({ indexes: (post, index) => [index([post.authorId], { where: { archived: { $ne: true } } })] })`; a string second argument is the index's name. Write the predicate as a query, not `sql`.
- JSON path index: read the path off the column's ref, `index([user.settings.theme])` for text, `index([{ column: user.settings.rating, type: Number }])` for any other value, `type: [String]` for an array's elements. MySQL keys a text path or element as `CHAR(n)`, `{ column: user.tags, type: [String], charLength: 64 }`, and a `TEXT` column by a prefix, `{ column: post.body, prefixLength: 64 }`.
- Triggers run in the database: `@Entity({ triggers: (post, trigger) => [trigger({ on: 'afterUpdate', of: [post.status], run })] })`, where `run` returns a body built from `insertInto`, `upsertInto`, `updateTable`, `deleteFrom` and `refuse(message)`. A trigger's writes skip uql's fills and entity filters. MongoDB has no triggers: https://uql-orm.dev/entities/triggers.md

### Choosing a form

Both forms are supported, mix them per entity, and produce the same queries and types.

- Decorators
  - Pros
    - A named class type shows on hover.
    - A column can be a foreign key (`@Field(f.references(() => User))`), so entities may reference each other in any order.
    - No `.relations()` ordering rules.
    - Shared structure through base classes (`StampedEntity`, `WorkspaceScoped`) that carry fields and relations.
    - The familiar form from TypeORM and MikroORM.
  - Cons
    - Each field is written twice, as a builder and as a TypeScript property (`@Field(f.string()) name!: string`).
    - The TC39 decorator transform is required: Node needs `tsx`, and some bundlers need a Babel step.
    - Without `@Entity({ name })`, the table name comes from the class name, which a minifier can change.
    - Higher type-check cost on the benchmark model (9,297 vs 5,110 instantiations).
    - Cannot be declared at run time.
    - `uql-codemod` cannot convert it into `defineEntity`.
- `defineEntity`
  - Pros
    - The row type is derived from the builders, with nothing written twice.
    - Shorter: 19 to 30% fewer lines in the two apps this was measured on.
    - Lower type-check cost on the benchmark model.
    - Shared relation helpers, and derived fields declared with their relations.
    - Plain data: no transform, and it can be built at run time (a CMS content type).
    - The form for projects that cannot enable TC39 decorators, such as legacy-decorator NestJS and Angular.
  - Cons
    - Relations are thunks declared after the columns, and `.relations()` comes last (only `.filters()` may follow it).
    - No column-level foreign keys: a shared key is a relation helper, and an eager read across two entities can create an inference cycle (TS7022).
    - Naming its row type as `X`, as a class does, takes a `type X = InstanceType<typeof X>` alias beside it.
    - No class to annotate or extend: inheritance uses `extends` naming the base.
    - Newer and less used.

### defineEntity

The same entities declared as data, the row type derived:

```ts
import { defineEntity, f, sql } from 'uql-orm';
import { z } from 'zod';

// Any Standard Schema types the payload: a Zod schema here.
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
  (author) => ({
    bookCount: () => author.books.count(),
    topStock: () => author.books.max((book) => book.stock),
    // A derived field may also combine its own columns with an aggregate in one expression.
    stockGap: () =>
      f
        .number()
        .nullable()
        .as(sql`${author.books.max((book) => book.stock)} - ${author.id}`),
  }),
);
export type Author = InstanceType<typeof Author>;

export const Book = defineEntity({
  name: 'Book',
  fields: {
    id: f.number().id(),
    title: f.string(),
    stock: f.number().default(0),
    authorId: f.number(),
    editorId: f.number().nullable(),
  },
})
  .computed((book) => ({ shout: f.string().as(sql`upper(${book.title})`) }))
  .indexes((book, index) => [index([book.title])])
  .hooks({ beforeInsert: [(book) => void (book.stock ??= 0)] })
  .relations((rel) => ({
    author: () => rel.manyToOne(Author, { references: (book) => book.authorId }),
    editor: () => rel.manyToOne(Author, { references: (book) => book.editorId, onDelete: 'SET NULL' }),
  }));
```

- Each field is a column builder, as in the decorated form. The row follows from them: a key, a version and a NOT NULL column are always present, a `.nullable()` one reads `| null`; a default (`.default()`, `.onInsert()`, `.autoIncrement()`) makes it optional on insert; `f.enum()` gives the literal union. No `!`, `?` or brands to write.
- The other options are sections chained after `defineEntity`, each called at most once: `computed`, `indexes`, `checks`, `triggers`, `filters` and `hooks` read the columns; `relations` comes last, but for a `filters` that reads through them: `.relations(...).filters({ byActiveAuthor: { where: { author: { active: true } } } })`. `defineEntity` itself takes `name` (the class name, which a naming strategy derives the table from), `table`, `schema`, `extends`, `abstract` and `fields`.
- Each relation is a thunk, `author: () => rel.manyToOne(...)`, so entities pointing at each other can sit in either order and in different files. In `defineEntity`, a foreign key is a relation: `manyToOne` names its `references` column, whose type is checked against the target's key; the column itself stays a plain field. `oneToMany(Book)` with no options is mapped by the one relation of `Book` pointing back.
- `relations`' second callback declares the derived fields: each value is a thunk, read lazily, of an aggregate over a to-many (`() => author.books.count()`) or a column expression. The callback's refs are the entity's own columns and its relations, so one expression can combine them.
- A hook is a function of the row and `{ querier, onCommit }`.
- A JSON column's payload is a Standard Schema, `f.json(schema)`, typed by its output: any library's schema (Zod, Valibot, ArkType), or a hand-written `StandardSchemaV1`. Without one, any path reads. The schema types the column; uql never runs it, so a write is not validated.
- Behaviour is a function of the row, `label(author: Author)`: a row reads back as a plain object, so a method would never be there.

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

- Query keys: `$select`, `$where`, `$populate`, `$count`, `$distinct`, `$sort`, `$skip`, `$limit`. `$count: { posts: true }` counts a to-many under `_count` without loading it. `$select: { password: false }` reads every field but `password`.
- Methods: `findMany`, `findOne`, `findOneById`, `findManyAndCount`, `findManyPage`, `findManyStream`, `count`, `exists`, `aggregate`, `insertOne`, `insertMany`, `updateOneById`, `updateMany`, `saveOne`, `saveMany`, `upsertOne`, `upsertMany`, `deleteOneById`, `deleteMany`. Each takes the entity class first, or the query's `$entity`. Signatures: https://uql-orm.dev/querying/methods.md
- Results are narrowed to what the query selected and populated, at every depth of `$populate`. Reading an unselected field is a compile error. Name a shape with `QueryFindResult<User, 'id' | 'email'>`, or `QueryFindResult<User, typeof query>` for a query declared `as const satisfies Query<User>`. A function forwarding a query keeps the narrowing by typing it `<E extends object, const Q extends Query<E>>(entity: Type<E>, q: Captured<Query<E>, Q>): Promise<QueryFindResult<E, Q>[]>`; typed `Query<E>`, it reads whole rows.
- `$populate` loads relations in the same statement. Nothing is lazy: an unpopulated relation is absent. A populated to-many is always a list, empty when there are no children. A to-one is optional unless `$required: true`, which keeps only the parents that have one.
- `$sort` takes `'asc'`/`1` or `'desc'`/`-1`, plus `'ascNullsLast'`, `'ascNullsFirst'`, `'descNullsFirst'`, `'descNullsLast'`, which behave the same on every engine. Unqualified, each engine keeps its own null order.
- `$where` takes a value for equality or an operator map: `$eq`, `$ne`, `$lt`, `$lte`, `$gt`, `$gte`, `$in`, `$nin`, `$between`, `$like`, `$ilike`, `$regex`, `$startsWith`, `$endsWith`, `$includes`, `$isNull`, `$isNotNull`. Combine with `$and`, `$or`, `$not`, `$nor`. `$regex` is case-sensitive unless the pattern opens with `(?i)`.
- An `undefined` anywhere in `$where` throws. Leave the key out to skip the filter (`...(email && { email })`), or name `null`.
- NULL compares as the engine does: on SQL, `$ne`, `$nin`, `$not` and `$nor` drop NULL rows, where MongoDB keeps them. To keep them, name NULL: `{ $or: [{ col: { $ne: 'a' } }, { col: null }] }`.
- `findManyPage(User, { $sort: { createdAt: -1, id: 1 }, $limit: 20, $after })` pages by cursor, so page 1,000 costs what page 1 does. It returns `{ items, startCursor, endCursor, hasNextPage, hasPrevPage }`. `$sort` must end in the key or a unique NOT NULL field, and takes no `$skip`.
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

Upgrading an existing project: `npx uql-codemod --dry-run`, then `npx uql-codemod`, which rewrites what it can and reports the rest. What changed by version: https://uql-orm.dev/upgrade-guide.md

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
