# Cursor pagination

A page is a `$where` fragment, not an offset. `$after` carries the sort key of the last row seen, the statement asks for the rows past it, and the next page costs the same as the first however deep it goes.

```ts
const page = await pool.findManyPage(Order, { $sort: { createdAt: -1, id: -1 }, $limit: 50, $after: cursor });
// { items, startCursor, endCursor, hasNextPage, hasPrevPage }
```

## Why

- **`$skip` drifts**: a row inserted before the offset shifts every later page, so a reader skips rows and sees others twice. Keyset is stable against inserts and deletes outside the window.
- **`$skip` is linear**: every engine here counts and discards the skipped rows. Page 10,000 reads 500,000 rows to return 50.
- **No `COUNT`**: the total is the expensive half of `findManyAndCount`, and a cursor page does not need one.

## Shape

`$after`/`$before` belong to `findManyPage` alone, so they are declared on their own query type rather than on `Query`:

```ts
type QueryKeyset<E> = Except<Query<E>, '$skip'> & { $after?: string; $before?: string };
```

- **`$skip` is subtracted**, the way `QueryOne` subtracts `$limit`: mixing an offset into a keyset page reintroduces exactly the drift the keyset removes.
- **`$after` and `$before` are both optional and a runtime throw when both are given**, not a two-member union. `$near` settled the same question: a union doubles what every call site instantiates, and `/http` casts client JSON straight to the query, so the check has to exist at runtime regardless.
- **`$limit` is the page size.** The statement asks for `$limit + 1` and the extra row answers `hasNextPage`, then is dropped before hydration, before `@AfterLoad`, and before the `loaded` hooks fire.
- **No count**, and no `includeCount` flag. A caller who wants one calls `count` with the same `$where`; what that call must not carry is the keyset fragment, which would count the remainder of the scan rather than the result set. MikroORM's `findByCursor` counts by default, which spends on every page the cost the feature exists to avoid.
- **The result name is not `QueryPage`** - that is taken by `QueryFilter & QueryPager`, the offset shape `count` reads.

## The condition

Lexicographic, nested, one arm per sort key, AND-merged into the statement the way a `security` filter is - never into the caller's `$where`, where a sibling `$or` or `{ filters: false }` could dissolve it:

```
a > x OR (a = x AND (b > y OR (b = y AND c > z)))
```

Every dialect already compiles this: it is `$or`, `$and`, `$gt`/`$lt` over fields, which is also how `whereIds` spells a composite key today. **v1 needs no dialect code at all.** A row-value comparison `(a, b, c) > (x, y, z)` is the faster form where an index can seek it, but it applies only when every key sorts the same direction and none can be null, and not every engine has one:

| Engine                                       | Ordered row comparison    |
| :------------------------------------------- | :------------------------ |
| Postgres, CockroachDB, PGlite, Neon, Bun SQL | yes, and it seeks a btree |
| MySQL 8.0.14+, MariaDB                       | yes, range scan           |
| SQLite, libSQL, Turso, D1                    | yes (3.15+)               |
| SQL Server                                   | no                        |
| Oracle                                       | `=` and `IN` only         |
| MongoDB                                      | no                        |

So the OR chain is the portable form and the row value is an optimization to measure, not the design.

**Backward** (`$before`) inverts every comparison and every `ORDER BY` term, then reverses the rows in memory; `hasNextPage` and `hasPrevPage` swap with it. The inverted order is what makes `$limit + 1` mean "one more row before the window" instead of after it.

## Nulls

The condition and the `ORDER BY` have to agree about where nulls sit, and in UQL today neither side says:

| Engine                        | Unqualified `ASC` puts nulls   | `NULLS FIRST/LAST` |
| :---------------------------- | :----------------------------- | :----------------- |
| Postgres, CockroachDB, Oracle | last                           | native             |
| SQLite, libSQL, Turso, D1     | first                          | native (3.30+)     |
| MySQL, MariaDB                | first                          | none               |
| SQL Server                    | first                          | none               |
| MongoDB                       | first (missing counts as null) | cannot be asked    |

Two consequences, and the second is why this is the item that gates the feature rather than a refinement of it:

1. `col > x` never matches a row whose `col` is null, so a page walks up to the null block and stops there, reporting `hasNextPage: false` with rows left. Entering it needs a null arm: `col IS NOT NULL` where the null block is behind, `col > x OR col IS NULL` where it lies ahead.
2. **A UQL column is nullable unless it says otherwise** - `schemaASTBuilder` reads `isPrimaryKey ? false : (field.nullable ?? true)`, and a decorator cannot see that the property was declared non-optional. So "refuse a nullable sort key" would refuse `{ createdAt: -1 }` on nearly every entity in the wild. The null arms are the default path, and a declared `nullable: false` is what removes them.

What lands with the feature, then:

- **`$sort` grows a placement**, as four more string literals on `QuerySortDirection` rather than an object: `'ascNullsLast' | 'ascNullsFirst' | 'descNullsFirst' | 'descNullsLast'`, camelCase per the convention for new union values, and free at the type level next to a second object shape.
- **One `EngineFeatures` knob, three-way like `commentSyntax`**: `nullsOrdering: 'clause' | 'expression' | 'none'` - the `NULLS` clause where it exists, a leading `col IS NULL` / `CASE WHEN col IS NULL` term on MySQL, MariaDB and SQL Server, nothing on MongoDB, which sorts nulls lowest and cannot be told otherwise. Plus `sortsNullsLowest`, so an unqualified direction is left alone instead of rewritten and `findManyPage` returns the order `findMany` returns.
- One parser reads the placement for both the `ORDER BY` and the condition. MikroORM shipped cursor pagination in v6 and reworked it in 7.2 for exactly this: the rewritten order dropped the qualifier, `desc nulls first` read as ascending, and a non-null offset never entered the null block - three ways for the two sides to disagree, all from resolving the direction twice.

## Totality

A keyset over a non-total sort skips or repeats rows silently, so it is refused rather than paged. The proof is in metadata and costs nothing at run time: the sort's key set must contain every column of `meta.ids`, or of some `unique` field or index whose columns are all declared `nullable: false` (a nullable unique column permits duplicate nulls on every engine here). Otherwise throw, naming the fix.

- A composite key is several sort keys, which the OR chain handles as-is; only the row-value form makes it one comparison.
- **On MongoDB a composite key is a sub-document `_id`**, whose comparison follows field order, so `$sort` names the key's parts rather than `_id`. Same refusal as everywhere else a compound `_id` appears.
- An entity with no key at all (R1, views) proves totality only through a unique index, and is refused otherwise.
- MikroORM and Prisma both check only that a value was supplied per ordered key, so a `$sort: { createdAt: -1 }` over a busy table mispages for them and throws here.

## What a `$sort` term can carry

UQL's `$sort` is wider than the sort a cursor can serialize, and each excess arm refuses for its own reason:

| Term                        | Cursor                                                                                                                                                                                                                                            |
| :-------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| field                       | yes                                                                                                                                                                                                                                               |
| JSON dot path               | yes - the path is a real JSON field, so the value is on the row and `$where` compares the same expression                                                                                                                                         |
| to-one relation field       | **no.** The sort reads a `LEFT JOIN` alias while a relation `$where` compiles to `EXISTS`, which drops parents with no related row. Expressing it means a condition against the join alias, which is dialect work rather than a `$where` fragment |
| `{ posts: { $count: -1 } }` | **no.** The term is a correlated `COUNT`; `$size` could spell the comparison, but it is a second correlated count per row per key, and the tally is not on the row unless `$count` projected it                                                   |
| vector `$sort`              | **no.** An ANN search is approximate, so "past this distance" is not a stable page, and an exact scan still ties. `$where: { embedding: { $near: { $lt } } }` is the honest way to ask for "closer than x"                                        |
| `raw`                       | **no.** Nothing names the value on the row                                                                                                                                                                                                        |

## The cursor itself

Opaque to the caller, base64url over the encoded sort values plus a fingerprint of the entity name and the sort definition (keys, directions, placements). The fingerprint is what turns "the caller changed `$sort` between pages" into an invalid-cursor error instead of a wrong page; MikroORM compares only the arity.

**The values are not JSON.** A UQL row does not hold what `JSON.parse` would give back:

- a BIGINT past 2^53 arrives as its exact decimal _text_ (`decodeWideNumber`), and a JSON number would round it on the way back;
- `type: BigInt` arrives as a `bigint`, which `JSON.stringify` throws on - the bug MikroORM fixed in 7.2;
- dates arrive as `Date`, bytes as a buffer, vectors as arrays.

The encode/decode pair already exists and is the one to reuse: `carriedFields` and `decodeColumn`/`HydrateKind`, which is how a relation's rows already cross JSON inside their parent's statement (wide ints as text, bytes as `\x` and hex, dates as ISO 8601). A decoded value then reaches the statement through the ordinary `$where` path, so `normalizeValue` binds it exactly, as it does for every other query.

Opaque is not signed. The cursor carries the sort values, so a caller holding one can read them; if a sort key is sensitive, so is the cursor. Signing it is the application's call, not the ORM's.

## Where it touches the rest

- **R6** is the gate: minting `endCursor` needs the sort values on the returned row, and `$select` need not have asked for them. Carrying them out as `_uql_cursor_<path>` aliases and stripping them before hydration is the fourth projection rule the roadmap names - and it is the same carry-out a relation's `_uql_sort_<path>` columns already do, so unifying first is what keeps it from being a fourth implementation.
- **The wire** needs a string clause group. `Query` has object, number and boolean groups; `$after`/`$before` are strings, so `parseQueryParams` would `JSON.parse` them today. A `QUERY_ROOT_STRING_CLAUSES` beside the others keeps the `satisfies` check and keeps them off a relation's own query - per-parent keyset is not this feature.
- **The envelope** carries `data` and an optional `count`. A page needs `endCursor`/`hasNextPage` beside them, and the response shape differs enough to earn its own route (`GET /page`) rather than a flag on `GET /`.
- **Aggregates are out of scope.** A keyset over `$group` rows compares against `HAVING`, not `WHERE`. Prisma gates post-group pagination on a prior `orderBy` at the type level; the same gate here is `$sort` on the aggregate, and the condition is a different builder.
- **`findManyStream`** is the same keyset walked internally. Worth revisiting once this lands: a resumable stream is a cursor the caller keeps.

## What it does not promise

Keyset pagination is stable against rows inserted or deleted outside the window. It is not stable against a row _updated_ across the boundary: change the `createdAt` of a row you have already passed and it can appear twice, or never. Only a repeatable-read transaction fixes that, and no transaction spans two HTTP requests. Say so in the docs rather than implying a snapshot.

## What the others do

| ORM                                 | Cursor pagination                                                                                                                                                              |
| :---------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MikroORM                            | `em.findByCursor`, Relay-shaped, opaque base64 cursor, over-fetch, counts by default. Shipped in v6, reworked in 7.2 for custom-type round trips and nullable keys             |
| Prisma                              | `cursor(...)` gated on a prior `orderBy` at the type level, values named per ordered column, OR-chain keyset, plain (non-opaque) cursor. Silently drops non-column order terms |
| TypeORM, Drizzle, Sequelize, Kysely | none. Drizzle's guidance is to write the `gt(...)` yourself                                                                                                                    |

The two that ship it agree on the OR chain and on over-fetching, disagree on whether the cursor is opaque, and neither checks that the sort is total. The rework MikroORM needed is the part to get right first here.
