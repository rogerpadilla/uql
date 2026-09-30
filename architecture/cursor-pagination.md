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
type QueryKeyset<E> = Except<Query<E>, '$skip'> & { $limit: number; $after?: string; $before?: string };
```

- **`$skip` is subtracted**, the way `QueryOne` subtracts `$limit`: mixing an offset into a keyset page reintroduces exactly the drift the keyset removes.
- **`$after` and `$before` are both optional and a runtime throw when both are given**, not a two-member union. `$near` settled the same question: a union doubles what every call site instantiates, and `/http` casts client JSON straight to the query, so the check has to exist at runtime regardless.
- **`$limit` is the page size, and required.** The statement asks for `$limit + 1` and the extra row answers `hasNextPage`, then is dropped before the `afterLoad` hooks fire.
- **`hasPrevPage` is "you arrived with a cursor"**, which is what it can honestly mean while paging forward: knowing whether rows exist behind the window costs a second statement, and the caller who has a cursor already knows. Paging backward, `$before` answers it from its own extra row and `hasNextPage` becomes the arrival flag.
- **No count**, and no `includeCount` flag. A caller who wants one calls `count` with the same `$where`; what that call must not carry is the keyset fragment, which would count the remainder of the scan rather than the result set. Counting by default spends on every page exactly the cost the feature exists to avoid.

## The condition

Lexicographic over the sort keys, AND-merged into the statement the way a `security` filter is - beside the caller's `$where` as a clause of its `$and`, never into its keys, where a sibling `$or` could dissolve it. It is a `$where` of the ordinary kind, built once in the querier (`querier/keyset.ts`), so every backend compares it with the operators it already renders and no dialect has a line of it.

The spelling decides whether the feature works at all. Measured on 200k-500k rows with the cursor in the middle, reading 50:

| Engine          | `a < x OR (a = x AND id < y)` | `a <= x AND (a < x OR id < y)` | `(a, id) < (x, y)` |
| :-------------- | :---------------------------- | :----------------------------- | :----------------- |
| Postgres 18     | **29.7 ms**, 250k filtered    | 0.077 ms, seek                 | 0.109 ms, seek     |
| CockroachDB 26  | 0.39 ms, seek                 | 0.86 ms                        | 0.42 ms, seek      |
| MySQL 26        | 0.32 ms, seek                 | 0.32 ms, seek                  | 0.31 ms, seek      |
| SQLite 3.51     | 0.004 ms, seek                | 0.005 ms, seek                 | 0.003 ms, seek     |
| SQL Server 2025 | 8 logical reads, seek         | 4 logical reads, seek          | no such comparison |

The plain OR chain scans Postgres from the top of the index, so a page deep in the table costs what the `$skip` it replaces costs. **The bounded chain `a <= x AND (a < x OR ...)` is the one form, on every engine**: it seeks everywhere, it is the fastest on Postgres, it expresses a mixed direction and a null arm, and MongoDB takes it as it is. Each bound holds a row at the cursor's key before the next key decides, the tie the plain chain spells as `a = x`, and it is what lets an index seek. A row-value comparison would win only on CockroachDB, by under half a millisecond, and only for keys running one way with no null, so it is not emitted.

The chain compares only the shortest leading run of the sort that proves it total (see Totality): past it no two rows tie, so the keys after it never decide a row, and the cursor carries none of them.

**Backward** (`$before`) inverts every comparison and every `ORDER BY` term, then reverses the rows in memory. The inverted order is what makes `$limit + 1` mean "one more row before the window" instead of after it.

## Nulls

The condition and the `ORDER BY` have to agree about where nulls sit. Half of that shipped ahead of this feature, since it was already a hole without it: the same `$sort` answered in a different order per engine. See [sorting](https://uql-orm.dev/querying/sorting) for what landed - four placements on `$sort`, rendered as the clause, a leading `IS NULL` term, a `CASE`, or MongoDB's flag field.

- `col > x` never matches a row whose `col` is null, so the chain carries a null arm per nullable key: `col IS NOT NULL` past a null where the null block is behind, `col > x OR col IS NULL` where it lies ahead, and within the block `col IS NULL` with the next key deciding.
- **A UQL column is nullable unless it says otherwise**, and a decorator cannot see that the property was declared non-optional, so refusing a nullable sort key would refuse `{ createdAt: -1 }` on nearly every entity. The null arms are the default, and a declared `nullable: false` or a key column is what drops them.
- **A null arm ahead costs the seek.** `(a >= x OR a IS NULL)` cannot seek, so Postgres reads the index from the top: 15.4 ms against 0.05 ms for the same page by a `nullable: false` key, over 200k rows, the cursor mid-table. Entering the null block with a second, seekable statement would recover it, and is not done: the docs point the leading key at `nullable: false` instead.
- **`DialectFeatures.nullsSortLowest`** says where an unqualified sort puts the nulls: lowest everywhere but Postgres, CockroachDB included. A placement answers for itself.
- **A placement costs the index on MySQL, MariaDB and SQL Server**, where it renders as a leading expression no index serves. Keyset paging there wants keys declared `nullable: false` and no placement.

One parser, `parseSortDirection`, reads a direction for the SQL `ORDER BY`, MongoDB's `$sort` and the condition alike. Resolving it twice is what breaks this elsewhere, in three separate ways: the rewritten order drops the qualifier, `desc nulls first` reads as ascending, and a non-null offset never enters the null block. `$before` inverts a placement with the order (`descNullsLast` walks back as `ascNullsFirst`) and leaves an unqualified key unqualified, since the engine's own placement inverts with it.

## Totality

A keyset over a non-total sort skips or repeats rows silently, so it is refused rather than paged. The proof is in metadata and costs nothing at run time: the sort's key set must contain every column of `meta.ids`, or of some `unique` field or index whose columns are all declared `nullable: false` (a nullable unique column permits duplicate nulls on every engine here). Otherwise throw, naming the fix.

- A composite key is several sort keys, which the chain handles as-is.
- A unique index with a `where` proves nothing: the rows outside it are free to tie.
- **On MongoDB a composite key is a sub-document `_id`**, whose comparison follows field order, so `$sort` names the key's parts rather than `_id`. Same refusal as everywhere else a compound `_id` appears.
- An entity with no key at all (R1, views) proves totality only through a unique index, and is refused otherwise.
- Checking only that a value was supplied per ordered key, which is the usual approach, mispages a `$sort: { createdAt: -1 }` over a busy table. That throws here.

## What a page refuses

Each for its own reason, and each named rather than answered wrongly:

| Asked for                     | Why not                                                                                                                                                                        |
| :---------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$distinct`                   | the rows are a grouping's output, and the keyset compares columns of a row the grouping may not keep                                                                           |
| a to-one relation's field     | the sort reads a `LEFT JOIN` alias while a relation `$where` compiles to `EXISTS`, which drops parents with no related row                                                     |
| `{ posts: { $count: -1 } }`   | the term is a correlated `COUNT`, a second one per row per key, and the tally is not on the row unless `$count` projected it                                                   |
| vector `$sort`                | an ANN search is approximate, so "past this distance" is not a stable page, and an exact scan still ties. `$where: { embedding: { $near: { $lt } } }` asks for "closer than x" |
| a JSON path                   | the `ORDER BY` compares the JSON value, typed per engine, where `$where` compares its text or number, so the two would not agree on every engine                               |
| `$text`, a relation aggregate | a score or tally computed per row, not stored on it                                                                                                                            |
| a raw `$select`               | the cursor is read off the row's fields, and a raw projection names none                                                                                                       |
| `$group`                      | a keyset over grouped rows compares against `HAVING`, not `WHERE`: a different builder, and out of scope                                                                       |

A field is what a cursor carries: a real value on the row, which `$where` compares as `$sort` ordered it.

**`$populate` is allowed**, to-many included. The extra `$limit + 1` row is cut from the parents before their relations are read, so a dropped parent costs nothing; a populated relation's own `$limit` is per parent and untouched by the page.

## The cursor itself

Opaque to the caller, base64url over the encoded sort values plus a fingerprint of the entity name and the sort definition (keys, directions, placements). The fingerprint turns "the caller changed `$sort` between pages" into an invalid-cursor error instead of a wrong page, where comparing only the count of values answers one.

**Two values are tagged.** A `Date`, whose JSON is its ISO text, which MongoDB compares as text and SQLite compares against its own text form; and a `bigint`, which JSON cannot spell. Everything else crosses as JSON: a BIGINT past 2^53 reads as its exact text (`decodeWideNumber`) and bound back as text compares exactly on every SQL engine, verified. A decoded value reaches the statement through the ordinary `$where` path, so `normalizeValue` binds it as the engine stores it. A JSON, vector or blob column is refused as a key before the read; a value of an engine's own type that is still an object is refused as the cursor is minted.

**A timestamp's value is exact because uql declares every one with 3 fractional digits**, the milliseconds a `Date` holds, so a value the database writes itself reads back as exactly what it stored. A key declaring more `precision` is refused: the cursor could not carry the boundary row's value, and the next page would repeat it or skip the rows after it.

Opaque is not signed. The cursor carries the sort values, so a caller holding one can read them; if a sort key is sensitive, so is the cursor. Signing it is the application's call, not the ORM's.

## Where it touches the rest

- **The sort values have to reach the querier**: minting `endCursor` reads them off the row, and `$select` need not have asked for them. A key the projection leaves out is added to it, spelled out whole, and deleted off the rows after the cursor is minted - so the page answers the fields `findMany` would, on every backend.
- **The wire** reads `$after`/`$before` as text, never JSON: `QUERY_CLAUSES` declares them `value: 'string'` and `scope: 'statement'`, which also keeps them off a relation's own query - per-parent keyset is not this feature.
- **HTTP** serves it on its own route, `GET /page` (or `QUERY`), with the page as the envelope's `data`: the envelope stays one shape, and the client's `findManyPage` answers `{ data: CursorPage }` as every other read answers `{ data }`.

## What it does not promise

Keyset pagination is stable against rows inserted or deleted outside the window. It is not stable against a row _updated_ across the boundary: change the `createdAt` of a row you have already passed and it can appear twice, or never. Only a repeatable-read transaction fixes that, and no transaction spans two HTTP requests.

## What the field ships

Two of the mature TypeScript ORMs offer keyset pagination at all: one Relay-shaped with an opaque cursor that over-fetches and counts by default, one gated on a prior sort at the type level with a plain readable cursor. The rest tell you to write the comparison yourself. Neither of the two checks that the sort is total, and neither picks its condition by what the engine can seek - the two things this design is built around. The first of them needed a rework for custom-type round trips and nullable keys, which this design settles up front.
