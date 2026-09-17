# Roadmap

The next feature block, in build order. Groundwork first, so the features on top stay small.

## Foundational refactors

Each is small on its own and gates something bigger. None is worth doing for its own sake.

**R1: an entity with no key.** `meta.ids` is a list that composite keys made plural; it cannot yet be empty. A view often identifies nothing, and every by-id path has to say so rather than take the first column of none. _Unlocks views._

```ts
defineView({ name: 'DailyTotals', ... }); // no @Id to give it
```

**R2: entity capabilities.** Whether an entity can be read, written or refreshed is not on its type, so nothing stops a write to something that has no table to write to. A `readable`/`writable`/`refreshable` set makes it a compile error instead of a runtime one. _Unlocks views._

```ts
await pool.insertOne(WorkspaceUsage, { total: 1 });
//                   ~~~~~~~~~~~~~~ not writable
```

**R5: `dialect.compile(query)`.** Building SQL and running it are one step today, so a caller cannot hold the text without executing it - and batching needs exactly that: several statements' text and values, gathered before any of them runs. It also makes the text a memoizable identity. _Unlocks batching._

```ts
const { sql, values } = dialect.compile(User, { $where: { id: 1 } });
```

**R6: one projection-alias concept.** A read's row type is assembled from pieces that each derive their own: `$select` through `QueryProjectedRow`, `$count` through `CountedRelations` under `_count`, an aggregate's `$select` through `QueryAggregateResult`. Cursor pagination adds a fourth - the sort keys it carries out of a row to mint a cursor from, whether or not `$select` asked for them - and `$window` a fifth. Unify the rule once, or every new projection re-derives it. _Unlocks cursor pagination, relation aggregates._

```ts
{ $select: { id: true }, $count: { posts: true } } // a read: id from one rule, _count from another
{ $group: { status: true }, $select: { total: { $sum: { amount: true } } } } // an aggregate: total from a third
```

**R7: schema objects as a dependency-ordered graph.** Ordering is already generic: `createOrder` in `schema/dependencyGraph.ts` takes any node and a function returning its dependencies. What is not is the diff - `SchemaDiffResult` has a field per kind (`tablesToCreate`, `tablesToDrop`, `columnDiffs`, `indexDiffs`), so a view or a trigger each add three more and every consumer grows a branch. A `SchemaObject` vocabulary flattens it. _Unlocks views, triggers._

```ts
// now                          // after
tablesToCreate: TableNode[]     create: SchemaObject[]
indexDiffs: IndexDiff[]         drop: SchemaObject[]
...one field per kind           alter: SchemaObjectDiff[]
```

The second kind that R7 waited for has arrived - generated columns in 0.46.0 - so the shape can be derived now rather than guessed.

## Correctness gaps

Small, independent of everything above, and each a way to damage data today.

**An unfiltered bulk write is refused.** `assertIdValue` guards the by-id methods only: `updateMany` and `deleteMany` take `{}`, or a `$where` untyped JSON left empty, and address the whole table. Check the caller's `$where` before filters add theirs (soft delete's would otherwise count as one), and make the whole table something asked for by name. Prisma 8 ships the same guard as its `deleteWithoutWhere`/`updateWithoutWhere` lints.

```ts
await pool.deleteMany(Session, {}); // throws: no $where
await pool.deleteMany(Session, {}, { unfiltered: true }); // the whole table, on purpose
```

**A migration can run outside a transaction.** `Migrator.runMigration` wraps every one, and Postgres refuses `CREATE INDEX CONCURRENTLY` inside one - the index a busy table needs is the one a migration cannot build. A per-migration flag, as Kysely 0.30's `transactionMode` has. The cost is the one it names: a failure part-way leaves the statements before it applied and the migration unlogged.

```ts
export default {
  transaction: false,
  async up(querier: SqlQuerier) {
    await querier.run('CREATE INDEX CONCURRENTLY idx_order_created ON "Order" ("createdAt")');
  },
};
```

**A nullable column's property admits `null`.** A column is nullable unless `nullable: false`, and a read hydrates `null` into it, yet `@Field({ type: String }) name?: string` compiles: the property says a read never returns what it does. Give the column overload of `Field` the exact check [triggers](triggers.md) gives aggregates, with `null` in the declared value unless `nullable: false`. Drizzle and Prisma type it that way because their types come from the schema. A decision rather than a fix: it changes most entities - 178 of Variability's 228 fields - and needs a codemod.

```ts
@Field({ type: String }) name?: string;                   // refused: the column can hold null
@Field({ type: String }) name?: string | null;
@Field({ type: String, nullable: false }) email?: string;
```

## Views and materialized views

```ts
export const WorkspaceUsage = defineView({
  name: 'WorkspaceUsage',
  materialized: true,
  from: () => Resource,
  query: { $group: { workspaceId: true }, $select: { total: { $count: '*' } } },
});
```

R2, R7. A view is an entity, just read-only, which dissolves the "relation with no entity" problem that makes CTEs a poor fit. Field types fall out of `QueryAggregateResult`; the definition is the migration. `REFRESH ... CONCURRENTLY` on Postgres/CockroachDB, refused elsewhere.

## Cursor pagination

```ts
await pool.findManyPage(Order, { $sort: { createdAt: -1, id: -1 }, $limit: 50, $after: cursor });
```

R6. A lexicographic OR-chain over `$or`/`$gt`/`$lt`, which every dialect already compiles, so v1 needs no dialect code; row-value comparison is a later optimization, and only where every key sorts one way and none is nullable. **Throw when the sort is not total**: a keyset page that silently skips or repeats rows is worse than an error, and `meta.ids` plus the unique indexes prove it for free.

What gates it is nulls. A UQL column is nullable unless declared otherwise, the engines disagree about where nulls sort, and `col > x` never matches one - so `$sort` grows a placement and `DialectFeatures` a `nullsOrdering` knob before any of this pages correctly. MikroORM shipped cursor pagination in v6 and reworked exactly this in 7.2. [The design](cursor-pagination.md).

## Triggers

```ts
@Field({ computed: (u) => u.resources.count() })               readonly resourceCount?: number; // read in the parent's statement
@Field({ computed: (u) => u.resources.count(), stored: true }) readonly resourceCount?: number; // kept by triggers
```

Two steps. The unstored aggregate needs no R7, runs on every engine, and shares its operators and compile path with the relation aggregates below. The stored arms - maintained aggregates, `stored: ['update']` stamps, then authored triggers - need R7 and ship on Postgres first. The maintained aggregate is the case worth declaring rather than authoring: it generates the reparent branch every hand-written counter forgets. [The design](triggers.md).

## Batching

```ts
const [users, total] = await pool.batch((q) => [q.findMany(User, { $limit: 10 }), q.count(User)]);
```

R5. One round trip on D1, libSQL/Turso and Neon HTTP; `BEGIN`/`COMMIT` and N round trips elsewhere: correct, not faster.

**The entity-level API cannot keep its promise.** Only reads, `count`, `exists` and an insert carrying no relation are reliably one statement: saving a relation needs the ids the insert generated, and `updateMany`/`deleteMany` run hooks and cascades. A caller cannot tell from the call site. The honest shape is statement-level over `compile()`, which gives up the typing that makes the rest of the API worth using. Decide before building either.

## Read-only queriers

```ts
export const replica: ReadonlyQuerierPool<PgQuerier> = new PgQuerierPool({ ... });
await replica.insertOne(User, { name: 'a' });
//            ~~~~~~~~~ does not exist
```

R2 at the pool: [pool.md](https://uql-orm.dev/pool) recommends a second pool for a replica, and nothing stops a write reaching it. Types only - a `Pick` of the reads (`findOne`, `findMany`, `findManyStream`, `findManyAndCount`, `count`, `exists`, `all`) - as Kysely 0.29's `ReadonlyKysely`.

## Optimistic locking

```ts
@Field({ version: true }) version?: number;

await pool.updateOneById(Post, id, { title, version: 3 }); // WHERE version = 3, SET version = 4
```

No row matched throws a stale-version error rather than returning `0`, which a caller reads as "nothing to update"; no driver raises it, so it is not a `QueryErrorKind`. UQL tracks no entity state, so the version the caller read rides in the payload; a payload without one is refused on a versioned entity. A number increments; a timestamp is `onUpdate`'s `now()`. Lands beside `fillOnFields(..., 'onUpdate')`, and Mongo filters on the field the same way.

## Relation aggregates

```ts
await pool.findMany(User, { $select: { id: true }, $count: { posts: true }, $max: { posts: { createdAt: true } } });
// { id, _count: { posts }, _max: { posts: { createdAt } } }
```

R6. `$count` over a relation is the one aggregate a read carries; `$sum`/`$avg`/`$min`/`$max` are the same correlated subquery with another function, and each lands under its own `_`-key. The unstored `computed` aggregate of [triggers](triggers.md) is the same compile path under a field's name. Prisma 8's `include(..., (posts) => posts.combine({ ... }))` is the same feature.

## Smaller items

- **Published on JSR.** Nearly free - a `jsr.json` and a publish step - and the only one here a user would notice from outside. Worth doing whenever someone wants it; nothing depends on it.
- **Oracle.** SQL Server shipped; Oracle is the half still designed, and a differentiator only Prisma and Drizzle also lack. It needs no R5 - its generated ids ride in the values array - and inherits `MergeSqlDialect`'s paging and upsert. [The design](oracle-mssql.md).
- **An agent skill in the tarball.** `skills/uql/` shipped inside `uql-orm`, stamped with its version so it never describes another release, as Prisma 8 and Drizzle v1 do. Mostly docs; the upgrade guide's per-version notes are its upgrading branch.

## Where a composite key still refuses

Each refuses by name rather than taking the first key column ([the design](https://uql-orm.dev/blog/composite-primary-keys)).

1. **Saving a relation** writes one child column for a whole page; several columns is a statement per parent.
2. **MongoDB**: a compound `_id` is a sub-document whose field order decides equality.
3. **The HTTP `/:id` route**: one path segment, and the adapters disagree about percent-decoding. `buildIdQuery` calls `soleIdOf` first, so a composite is refused before it can under-specify a row.

TypeScript cannot accumulate `@Id` across properties, so the key is named in the class body or not at all: `@Id` refuses one the `idKey` brand and the conventional names both leave unnamed, and `assertIdValue` checks the value at run time.

## Shipped, and not worth re-litigating

`defineEntity({ extends })`, the functional form of the base a class cannot extend, in 0.59.0; one id shape for every write in 0.50.0, upserts included in 0.51.0; per-parent `$limit`/`$skip` on a populated relation in 0.47.0; `computed`/`stored` generated columns in 0.46.0; foreign keys on sync in 0.45.0; composite keys in 0.42.0 and migrations for them in 0.42.1; enums and check constraints in 0.41.1; `raw` as a tagged template in 0.40.0.

- **An id is accepted as either spelling and reported as one.** `EntityId` is the union a by-id method takes, because a caller holding one column's value has to reach the same parameter as one holding a map. `WrittenId` picks a branch, because a write knows which it produced. Merging the two was measured and is worse: it refuses `findOneById(X, 'abc')` on any entity whose key the type level cannot name. `WrittenId` falls back to the union there for the same reason. A `$where` takes neither spelling: it is a map, and `whereIds` is where an id becomes one.
- **The key is a list with nothing beside it.** TypeORM keeps `primaryColumns[0]`, MikroORM a `compositePK` flag; either lets a path address every row agreeing on one column of two. `assertSoleId` is the only way past `meta.ids`, and it throws.
- **Keys and indexes are compared by their columns, never by name.** Matching on names would rewrite every table the first time a naming convention changed.
- **A check is never diffed.** It is SQL text, and a database reprints it from its parse tree. Created with its table; changing one is a hand-written migration. The sync path was built and reverted.
- **An enum is a column check, not a native type.** `CREATE TYPE` needs its own ordering and `ALTER TYPE ... ADD VALUE` is irreversible. The cost: checks are never diffed, so **adding a value emits nothing and the column keeps rejecting it**. No fix spans the matrix: the accepted values would have to ride in the column's comment for the differ to see them, and SQLite and SQL Server carry no comment at all (`commentSyntax: 'none'`).
- **A generated key is spelled from its declared type.** It was a fixed string per dialect, so `@Id({ columnType: 'int' })` emitted `BIGINT` while the column referencing it emitted `INT`. One rule decides whether a key is generated, and both the schema and the insert path ask it.
- **A relation's `$limit` is each parent's share, not a slice of one page.** [The design](relations-in-one-statement.md).
- **A column shape is derived, never listed field by field.** `ColumnSchema` is `ColumnNode` minus the graph links, and each conversion spreads. Five hand-written copies each dropped a different option - `enum`, then `generatedAs`, then `comment` - and a column reached the database without what the entity declared.
- **An unstored `computed` is written out by every clause that names it.** `$sort` used the output alias, so ordering by one you had not selected failed on the server.
- **Every field option states where it applies, in one table.** `FIELD_OPTION_FAMILY` pairs each option with its column family, `deadOn` with what makes it dead. A new option cannot be added without answering both. Only a contradiction is rejected, never a redundancy.
