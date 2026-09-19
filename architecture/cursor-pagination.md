# Cursor pagination

A page is a `$where` fragment, not an offset. `$after` carries the sort keys of the last row seen, the statement asks for the rows past them, and the next page costs the same as the first however deep it goes.

```ts
const page = await pool.findManyPage(Order, { $sort: { createdAt: -1, id: -1 }, $limit: 50, $after: cursor });
// { items, startCursor, endCursor, hasNextPage, hasPrevPage }
```

## Why

- **`$skip` drifts**: a row inserted before the offset shifts every later page, so a reader skips rows and sees others twice. Keyset is stable against inserts and deletes outside the window.
- **`$skip` is linear**: every engine here counts and discards the skipped rows. Page 10,000 reads 500,000 rows to return 50.
- **No `COUNT`**: the total is the expensive half of `findManyAndCount`, and a cursor page does not need one.

## Why a method of its own

`findMany` returns `E[]`, narrowed to what the query projected. A page also answers `endCursor` and `hasNextPage`, and putting those on `findMany` means a return type that branches on whether `$after` was passed - instantiated at every read signature, for the few calls that page. A page also fetches `$limit + 1` and discards a row, refuses `$skip`, and refuses a sort it cannot prove total, none of which `findMany` should start doing. `findManyAndCount` is the precedent: same query, different envelope, own method.

The alternative shape - a plain array plus a cursor the caller builds from the last row - only works if the sort keys were selected, and hands the caller the encoding problem: a wide `BIGINT`, a `Date`, bytes. That is the part this design exists to solve.

The envelope type is `CursorPage<E>`, not `QueryPage`, which is the offset shape (`QueryFilter & QueryPager`) that `count` reads.

## Shape

`$after`/`$before` belong to `findManyPage` alone, so they are declared on their own query type rather than on `Query`:

```ts
type QueryKeyset<E> = Except<Query<E>, '$skip'> & { $after?: string; $before?: string };
```

- **`$skip` is subtracted**, the way `QueryOne` subtracts `$limit`: mixing an offset into a keyset page reintroduces exactly the drift the keyset removes.
- **`$after` and `$before` are both optional and a runtime throw when both are given**, not a two-member union. `$near` settled the same question: a union doubles what every call site instantiates, and `/http` casts client JSON straight to the query, so the check has to exist at runtime regardless.
- **`$limit` is the page size.** The statement asks for `$limit + 1` and the extra row answers `hasNextPage`, then is dropped before hydration, before `@AfterLoad`, and before the `loaded` hooks fire.
- **`hasPrevPage` is "you arrived with a cursor"**, which is what it can honestly mean while paging forward: knowing whether rows exist behind the window costs a second statement, and the caller who has a cursor already knows. Paging backward, `$before` answers it from its own extra row and `hasNextPage` becomes the arrival flag.
- **No count**, and no `includeCount` flag. A caller who wants one calls `count` with the same `$where`; what that call must not carry is the keyset fragment, which would count the remainder of the scan rather than the result set. Counting by default spends on every page exactly the cost the feature exists to avoid.

## The condition

Lexicographic over the sort keys, AND-merged into the statement the way a `security` filter is - never into the caller's `$where`, where a sibling `$or` or `{ filters: false }` could dissolve it.

There are two spellings, and **which one is emitted decides whether the feature works at all**. Measured on 200k-500k rows with the cursor in the middle, reading 50:

| Engine          | `a < x OR (a = x AND id < y)` | `a <= x AND (a < x OR id < y)` | `(a, id) < (x, y)` |
| :-------------- | :---------------------------- | :----------------------------- | :----------------- |
| Postgres 18     | **29.7 ms**, 250k filtered    | 0.077 ms, seek                 | 0.109 ms, seek     |
| CockroachDB 26  | 0.39 ms, seek                 | 0.86 ms                        | 0.42 ms, seek      |
| MySQL 26        | 0.32 ms, seek                 | 0.32 ms, seek                  | 0.31 ms, seek      |
| SQLite 3.51     | 0.004 ms, seek                | 0.005 ms, seek                 | 0.003 ms, seek     |
| SQL Server 2025 | 8 logical reads, seek         | 4 logical reads, seek          | no such comparison |

The plain OR chain scans Postgres from the top of the index, so a page deep in the table costs what the `$skip` it replaces costs. MySQL and SQLite rewrite the OR into an index range and CockroachDB derives a constraint from it; Postgres does neither. So:

- **A row-value comparison `(a, b) < (x, y)` is the primary form**, on every engine that has one: Postgres and its family, CockroachDB, MySQL, MariaDB, SQLite and its family. It seeks everywhere it applies, and it says the condition once.
- **It applies only when every key sorts the same direction and none of them is nullable**, since it cannot express a mixed order or a null placement.
- **Otherwise, the bounded OR chain** `a <= x AND (a < x OR ...)`, which is the fallback everywhere: it seeks on Postgres, MySQL, SQLite and SQL Server, and costs CockroachDB about 2x its best. The redundant leading bound is what lets an index seek, and dropping it is what makes Postgres scan.
- **SQL Server and MongoDB take the fallback always**, having no row-value comparison.

One `DialectFeatures` knob, `rowValueComparison`, picks between them. This is not an optimization to add later: without it the feature does not deliver on Postgres, which is the engine most callers are on.

**Backward** (`$before`) inverts every comparison and every `ORDER BY` term, then reverses the rows in memory. The inverted order is what makes `$limit + 1` mean "one more row before the window" instead of after it.

## Nulls

The condition and the `ORDER BY` have to agree about where nulls sit. Half of that shipped ahead of this feature, since it was already a hole without it: the same `$sort` answered in a different order per engine. See [sorting](https://uql-orm.dev/querying/sorting) for what landed - four placements on `$sort`, rendered as the clause, a leading `IS NULL` term, a `CASE`, or MongoDB's flag field.

**Left for the cursor:**

1. `col > x` never matches a row whose `col` is null, so a page walks up to the null block and stops there, reporting `hasNextPage: false` with rows left. Entering it needs a null arm: `col IS NOT NULL` where the null block is behind, `col > x OR col IS NULL` where it lies ahead.
2. **A UQL column is nullable unless it says otherwise**, and a decorator cannot see that the property was declared non-optional. So "refuse a nullable sort key" would refuse `{ createdAt: -1 }` on nearly every entity in the wild. The null arms are the default path, and a declared `nullable: false` is what removes them - and what lets the row-value form be used.
3. **A second knob, `sortsNullsLowest`**, for the unqualified case: the condition has to know what the engine's own default did.
4. **A placement costs the index on MySQL, MariaDB and SQL Server**, where it renders as a leading expression no index serves. Keyset paging on those engines wants keys declared `nullable: false` and no placement; the docs say so rather than letting a caller discover it at scale.

One parser reads the placement for both the `ORDER BY` and the condition. Resolving the direction twice is what breaks this elsewhere, in three separate ways: the rewritten order drops the qualifier, `desc nulls first` reads as ascending, and a non-null offset never enters the null block.

## Totality

A keyset over a non-total sort skips or repeats rows silently, so it is refused rather than paged. The proof is in metadata and costs nothing at run time: the sort's key set must contain every column of `meta.ids`, or of some `unique` field or index whose columns are all declared `nullable: false` (a nullable unique column permits duplicate nulls on every engine here). Otherwise throw, naming the fix.

- A composite key is several sort keys, which both forms handle as-is.
- **On MongoDB a composite key is a sub-document `_id`**, whose comparison follows field order, so `$sort` names the key's parts rather than `_id`. Same refusal as everywhere else a compound `_id` appears.
- An entity with no key at all (R1, views) proves totality only through a unique index, and is refused otherwise.
- Checking only that a value was supplied per ordered key, which is the usual approach, mispages a `$sort: { createdAt: -1 }` over a busy table. That throws here.

## What a page refuses

Each for its own reason, and each named rather than answered wrongly:

| Asked for                   | Why not                                                                                                                                                                        |
| :-------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$distinct`                 | the rows are a grouping's output, and the keyset compares columns of a row the grouping may not keep                                                                           |
| a to-one relation's field   | the sort reads a `LEFT JOIN` alias while a relation `$where` compiles to `EXISTS`, which drops parents with no related row                                                     |
| `{ posts: { $count: -1 } }` | the term is a correlated `COUNT`, a second one per row per key, and the tally is not on the row unless `$count` projected it                                                   |
| vector `$sort`              | an ANN search is approximate, so "past this distance" is not a stable page, and an exact scan still ties. `$where: { embedding: { $near: { $lt } } }` asks for "closer than x" |
| `raw` in `$sort`            | nothing names the value on the row                                                                                                                                             |
| `$group`                    | a keyset over grouped rows compares against `HAVING`, not `WHERE`: a different builder, and out of scope                                                                       |

A field, and a JSON dot path, are what a cursor carries: both are real values on the row, and `$where` compares the same expression that `$sort` ordered by.

**`$populate` is allowed**, to-many included. The extra `$limit + 1` row is cut from the parents before their relations are read, so a dropped parent costs nothing; a populated relation's own `$limit` is per parent and untouched by the page.

## The cursor itself

Opaque to the caller, base64url over the encoded sort values plus a fingerprint of the entity name and the sort definition (keys, directions, placements). The fingerprint turns "the caller changed `$sort` between pages" into an invalid-cursor error instead of a wrong page, where comparing only the count of values answers one.

**The values are not JSON.** A UQL row does not hold what `JSON.parse` would give back: a BIGINT past 2^53 arrives as exact decimal _text_ (`decodeWideNumber`) that a JSON number would round; a `type: BigInt` field arrives as a `bigint`, which `JSON.stringify` throws on; dates arrive as `Date` and bytes as a buffer. The encode/decode pair already exists and is the one to reuse: `carriedFields` and `decodeColumn`/`HydrateKind`, how a relation's rows already cross JSON inside their parent's statement. A decoded value then reaches the statement through the ordinary `$where` path, so `normalizeValue` binds it exactly.

Opaque is not signed. The cursor carries the sort values, so a caller holding one can read them; if a sort key is sensitive, so is the cursor. Signing it is the application's call, not the ORM's.

## Where it touches the rest

- **The sort values have to reach the querier**: minting `endCursor` reads them off the row, and `$select` need not have asked for them. They are carried out as `_uql_cursor_<path>` aliases and stripped before hydration, as `_uql_total` already is - the only other column a read adds to its own rows, and three lines of it.
- **The wire** needs a string clause group. `Query` has object, number and boolean groups; `$after`/`$before` are strings, so `parseQueryParams` would `JSON.parse` them today. A `QUERY_ROOT_STRING_CLAUSES` beside the others keeps the `satisfies` check and keeps them off a relation's own query - per-parent keyset is not this feature.
- **The HTTP envelope** carries `data` and an optional `count`. A page needs `endCursor`/`hasNextPage` beside them, enough of a difference to earn its own route (`GET /page`) rather than a flag on `GET /`.
- **`findManyStream`** is the same keyset walked internally. Worth revisiting once this lands: a resumable stream is a cursor the caller keeps.

## What it does not promise

Keyset pagination is stable against rows inserted or deleted outside the window. It is not stable against a row _updated_ across the boundary: change the `createdAt` of a row you have already passed and it can appear twice, or never. Only a repeatable-read transaction fixes that, and no transaction spans two HTTP requests. Say so in the docs rather than implying a snapshot.

## What the field ships

Two of the mature TypeScript ORMs offer keyset pagination at all: one Relay-shaped with an opaque cursor that over-fetches and counts by default, one gated on a prior sort at the type level with a plain readable cursor. The rest tell you to write the comparison yourself. Neither of the two checks that the sort is total, and neither picks its condition by what the engine can seek - the two things this design is built around. The first of them needed a rework for custom-type round trips and nullable keys, which is why both are settled here before any code.
