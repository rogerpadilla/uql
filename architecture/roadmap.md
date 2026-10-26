# Roadmap

What is next, in build order: groundwork first, so the features on top stay small. One rule on every engine, emulated where an engine lacks it, refused only where it cannot be done.

## Before 1.0

- ready for RC.

## After 1.0

Additive: an entity that declares nothing keeps every capability, so none of this breaks code written for 1.0.

**R1: an entity with no key.** `meta.ids` cannot be empty yet, and a view often has no key. Every by-id path refuses one by name instead of taking the first column of none. A keyless entity is read-only, and a write to it is refused by name at run time. _Unlocks views._

**R2: a `writable` flag.** One optional flag on the entity's type, `writable: false`, that the write methods' signatures check once, so a write to a view is a compile error. Optional and defaulting to writable, so it adds no break. Gated on `bun run ts.perf`. A general capability set is not planned.

**Read-only queriers.** `ReadonlyQuerierPool<PgQuerier>`, a `Pick` of the read methods, so a write never reaches a replica pool. Types only.

**Views and materialized views** (R1, R2).

```ts
export const WorkspaceUsage = defineView({
  name: 'WorkspaceUsage',
  materialized: true,
  from: () => Resource,
  query: { $group: { workspaceId: true }, $select: { total: { $count: '*' } } },
});
```

A view is a read-only entity whose definition is its migration, and its field types come from `QueryAggregateResult`. A materialized view is native on Postgres and CockroachDB (`REFRESH ... CONCURRENTLY`). Elsewhere it is emulated as a table that `refresh` empties and refills in one transaction. Its migration is a schema-level object that states the tables it reads, sorted with the existing `createOrder`; tables, columns, indexes and checks keep their per-kind diff.

**Read-only queriers** (R2). `ReadonlyQuerierPool<PgQuerier>`, a `Pick` of the read methods, so a write never reaches a replica pool. Types only.

## Later

- **From Mongoose.** Entities written from Mongoose schemas by the codemod, beside the copy and shadow-read recipe. [The design](from-mongoose.md).
- **Oracle.** The half of [the design](oracle-mssql.md) not yet built; it inherits `MergeSqlDialect`'s paging and upsert.
- **Custom types.** A field's `type` may be a value type of the app's own (Money, Decimal, Point, an encrypted string), stated once as its column and its two conversions: `defineType({ column: 'numeric', precision: 12, scale: 2, read: (text) => Money.parse(text), write: (money) => money.toString() })`, then `@Field({ type: MoneyType }) price?: Money`. The field's TS type is checked against what `read` returns, as `type: Number` is against `number`. `$where`, cursors, row keys and literals write through `write`, so a `Money` compares as its column does; DDL and introspection see only `column`. Plain data, no class to extend, so the same type serves both entity forms and a query stays JSON on the wire (the client sends `write`'s output). Temporal below is then one built-in instance of it.
- **Temporal values, opted into per field.** `type: Temporal.PlainDate` on a `date` column, `Temporal.PlainTime` on a `time` one, `Temporal.Instant` on a timestamp, as `type: BigInt` already picks a JS value over the same column: DDL and introspection stay untouched. The field's `type` is typed structurally as `{ from(text: string): T }`, so the library's types never name `Temporal` and a consumer without the lib still compiles. Reads call `type.from(text)` and writes call `value.toString()`, both on the field's own constructor, so nothing detects `Temporal` at run time and a polyfill works too. A runtime without `Temporal` fails where the class is defined, which reads `Temporal` first. Needs: `isOperatorMap` accepts only a plain object, so a `PlainDate` in `$where` is not dropped; the cursor, row-key and literal paths take Temporal values; Postgres's `date` wire rule stops short-circuiting these kinds; a `PlainTime`'s nanoseconds are truncated or refused, decided at build. Variability's `dateColumn`/`fromDateColumn` would go.
- **Named locks.** `querier.lock(name, { timeout })` waits for a lock on a name, not a row, and holds it to the end of the transaction, as Postgres's `pg_advisory_xact_lock` and MSSQL's `sp_getapplock` with `'Transaction'` do. The engine's `features.namedLocks` already says which hold: `'transaction'` (Postgres, MSSQL), `'session'` (MySQL and MariaDB), `false` (CockroachDB, SQLite). The migration lock's SQL in `migrationLock.ts` is the first half. MySQL releases its `GET_LOCK` when the transaction ends, on commit or rollback, and a call outside one is refused. Where an engine has no named lock, the lock is a row in a table taken with `SELECT ... FOR UPDATE`. Open: whether SQLite's single writer already covers it, and how a lock on a name shows in `$where` (it does not). Prisma's marker lock and Kysely's migration lock are the precedents.
- **Schema-scoped objects.** Extensions, functions and domains declared beside the entities (`objects: [{ kind: 'extension', name: 'pg_trgm' }]`), applied by `sync` and `up` before the tables using them; a function is named by its signature. Variability hand-rolls these in four places.

## Settled, not to re-litigate

- **A stored aggregate kept by triggers is refused for now.** A read is about 70x faster on Postgres, but four concurrent writers on one parent take 200 to 260 s against 0.3 to 10 s without the trigger, since the row lock is held across each statement. Revisit with a batched or statement-level trigger, measured first.
- **A JSON payload is typed by a Standard Schema's output, and never parsed.** `f.json(schema)` takes Zod, Valibot or ArkType and types the column by its output; writes take the output, not the input, since an input that a transform or a default converts would store a document the read type misstates. Nothing is stored at run time, as with the removed `shape`. Writes are never validated against the schema: uql does not run `validate` on a write, a per-write cost it does not pay. A schema declaring no `types` property is refused by the weak-type check.
- **An id is either spelling in, one spelling out.** A by-id method takes `EntityId`, the union; `WrittenId` is the branch a write produced. Merging them refuses `findOneById(X, 'abc')` wherever the key cannot be named.
- **The key is a list.** Every path carries every column of it, a relation's child or junction row included (one column per key column, from `references`). `assertSoleId` refuses the rest by name, never taking the first column: MongoDB (a compound `_id` compares by field order; use a unique compound index) and the HTTP `/:id` route (a composite row is reachable through `$where`).
- **Keys and indexes compare by columns, not names**, so a naming-convention change rewrites nothing.
- **A check is compared by name.** It is installed as `_uql_<table>__<label>_<hash>`, the hash of its SQL, as a trigger is: an edited check is a new name, the old one dropped. Safe mode adds the new one and holds the drop, as it does an index. Only a `_uql_` check is ever dropped; any other is warned about on a table declaring checks.
- **An unnamed partial index is named by a hash of its predicate**, as a check is: the engine's reprint never matches what uql wrote, so the name carries the edit and a changed `where` is a new index, the old one dropped. A named one's predicate is compared only by whether it is there, so adding or removing one rebuilds it. An index expression and a stored computed column's expression are not diffed (a fingerprint table is not worth keeping for an edit nobody has made); changing one is a written migration. An index's `where` is spelled as the predicate the query passes, never as `sql`, or the planner will not match the two.
- **SQLite alters a table by rebuilding it, foreign keys off.** Dropping the old table with them on deletes every `CASCADE` child and fails a `NO ACTION` one, and `defer_foreign_keys` stops neither; `PRAGMA foreign_keys` only switches outside a transaction. So the migration session switches it around the transaction and runs `foreign_key_check` before commit, and the rebuild carries a guard failing it wherever they stay on (D1, a remote libSQL).
- **An enum is a check, not a native type**: a named table constraint, since MariaDB names a column-level one itself. Changing its values replaces the check like any other.
- **A cursor page compares by the bounded chain `a <= x AND (a < x OR ...)` on every engine**, as a plain `$where`. A row-value comparison wins only on CockroachDB, by under half a millisecond, and only for keys running one way with no null. [The design](cursor-pagination.md).
- **A relation's `$limit` is each parent's share.** [The design](relations-in-one-statement.md).
- **A column shape is derived, never copied field by field.** Five hand copies each lost a different option.
- **A relation aggregate is declared, not spelled in a query.** A query-time `$max: { posts: ... }` would add a type parameter per op to all 36 read signatures; a `computed` field does more (`$where`, `$sort`, an exact type) at no such cost. `$sort` keeps the two a declaration cannot: `$count`, and a relation's nearest row to a vector.
- **A nullable column's property admits `null`, and only that.** Family types (`jsonb`, `numeric`) stay narrowable.
- **Every field option states where it applies**, in `FIELD_OPTION_FAMILY`; only contradictions are rejected.
- **No computed vector distance on D1 or MySQL.** Both store vectors as JSON, and a distance over it measured 10 ms to 230 ms a row. D1 points at Vectorize, MySQL at HeatWave.
- **A JSON update is folded to one write per path.** MySQL, MariaDB and SQLite bind by position, so no write may read what an earlier one left: `foldJson` works out every operator reaching a value another wrote before any SQL is written, and each write reads the column as stored. SQL Server, whose `JSON_QUERY` refuses a scalar, writes a key's value only where it is not NULL: a NULL one goes to a key that is not there, which `JSON_MODIFY` leaves alone.
- **No fuzzy-match or `$max`/`$min` update operator.** Neither has a portable form or a caller `sql` does not already serve.
- **A split write runs all or none, through one `runStatements` per querier.** One request on D1, Turso Cloud, libSQL and Neon over HTTP, a transaction elsewhere. [The design](split-writes.md).
- **No DynamoDB driver yet.** Table per entity misfits its single-table design; revisit on demand.
