# Per-parent limits on a populated relation

Design for the per-parent populate item, shipped in 0.47.0. Every SQL dialect and MongoDB; no R7 dependency.

## The problem

`$limit` inside a to-many `$populate` caps the whole result set, not each parent's share. A to-many is loaded with one batched query over every parent, so `$limit: 5` returns five children in total and `putChildrenInParents` hands them to whichever parents they happened to belong to. Every other parent gets `[]`, which is indistinguishable from having no children at all.

```ts
// 3 posts, 5 comments each, asking for the 2 newest per post
$populate: { comments: { $sort: { id: -1 }, $limit: 2 } }
// a -> []   b -> []   c -> ['c5', 'c4']
```

The docs called this inherent - "the 5 newest posts of each author is not expressible through `$populate`" - and recommended dropping to a window-function `raw()`. It is not inherent.

## What shipped

**`$limit` and `$skip` inside a to-many `$populate` became per-parent.**

```ts
await pool.findMany(User, {
  $populate: { posts: { $sort: { createdAt: -1 }, $limit: 5 } },
});
// every user carries their own five newest posts
```

**A minor, not a major.** Existing code compiled and returned different rows, which normally forces a major - but the rows it returned were wrong, attributed to parents that did not own them while parents that did got `[]`. That is a fix, not a behaviour change, and it shipped the way other `Breaking:` entries here have. It is also the reading the surrounding design already implies, since `$sort`, `$limit`, `$skip` and `$distinct` are documented as belonging to the relation's own query; global was the leaky detail.

Emitted only when a to-many populate actually carries `$limit` or `$skip`. Otherwise the existing flat statement with its `IN (...)` list stays, and stays cheaper.

## The shape

One seam, two fan-outs. The **inner query** is byte-identical in both: projection, `$where`, soft-delete filter, `$sort`, `$limit`, `$skip`, `$distinct` and the many-to-many junction join are written once and neither shape touches them. Only how it is spread over the parent keys differs.

```sql
-- default (AbstractSqlDialect): inner repeated per key, wrapped and concatenated
  SELECT * FROM (SELECT <cols> FROM <child> WHERE <fk> = ? ORDER BY <sort> LIMIT ? OFFSET ?) "_uql_p0"
UNION ALL
  SELECT * FROM (SELECT <cols> FROM <child> WHERE <fk> = ? ORDER BY <sort> LIMIT ? OFFSET ?) "_uql_p1"

-- PgLikeSqlDialect: inner written once, key referenced from an array row source
SELECT p.k, c.* FROM UNNEST($1::bigint[]) AS p(k)
JOIN LATERAL (SELECT <cols> FROM <child> WHERE <fk> = p.k ORDER BY <sort> LIMIT ? OFFSET ?) c ON true
```

MongoDB is the same idea through `$unionWith`: one bounded sub-pipeline per parent key.

```js
[ { $match: { <fk>: k1 } }, { $sort: <sort> }, { $skip: m }, { $limit: n },
  { $unionWith: { coll: '<child>', pipeline: [ { $match: { <fk>: k2 } }, { $sort: <sort> },
                                               { $skip: m }, { $limit: n } ] } } ]
```

**Why UQL can use the simplest shape and the join-based ORMs cannot.** Drizzle and Prisma join the relation into the parent statement and JSON-aggregate it, so they need a correlated construct on every dialect. UQL loads a to-many with a separate batched query and already holds the parent keys in memory, so it can just ask for each one's top N. The keys are the ones `parentsIn` builds today.

## Why `UNION ALL` is the default

Every strategy the surveyed ORMs use, tested on this repo's own containers:

| Shape                                   | PG 18 | CRDB 26.3 | MySQL 26.7     | MariaDB 12.3   | SQLite | Rows read                    |
| :-------------------------------------- | :---- | :-------- | :------------- | :------------- | :----- | :--------------------------- |
| **`UNION ALL` of bounded subqueries**   | yes   | yes       | yes            | yes            | yes    | **parents x (skip + limit)** |
| `LATERAL` against an array row source   | yes   | yes       | yes, but slow  | **no**         | **no** | parents x (skip + limit)     |
| `ROW_NUMBER` window + outer rank filter | yes   | yes       | yes            | yes            | yes    | **all matching**             |
| correlated `IN` + `LIMIT`               | yes   | yes       | **ERROR 1235** | **ERROR 1235** | yes    | -                            |

`UNION ALL` is the only one that is universal, and the only one that is never catastrophic. Wall clock, 298k children with 50 "viral" parents holding 2,000 each, asking for three - 150 rows out either way:

| viral page | `UNION ALL` | `ROW_NUMBER` |
| :--------- | ----------: | -----------: |
| Postgres   |      1.5 ms |      11.3 ms |
| MySQL      |      3.9 ms |      46.8 ms |
| MariaDB    |      0.9 ms | **149.0 ms** |
| SQLite     |      0.2 ms |      36.0 ms |

Drop to 40 children per parent and the window is 0.7-1.7 ms everywhere. Its cost tracks its **input**, not its output: the whole partition must be materialised and sorted before `rn <= n` can filter it, because no engine here has a "stop after n per partition" operator. An index in exactly `(fk, sort)` order removes the sort but not the scan - Postgres has no loose index scan, and the `Run Condition` pushed into the `WindowAgg` stops it _emitting_, not the scan advancing.

**The trade is between two costs, and the deciding question is which one the caller controls.** `UNION ALL` scales with page size, which the developer typed as `$limit` on the parent query and can see. The window scales with total matching children, which nobody controls and which grows silently as the table does - the shape that works in development and falls over in production.

| ordinary parents, Postgres |      10 |      50 |     100 |      500 |
| :------------------------- | ------: | ------: | ------: | -------: |
| `UNION ALL`                | 0.59 ms | 1.44 ms | 2.71 ms | 10.48 ms |
| `LATERAL`                  | 0.38 ms | 0.53 ms | 0.50 ms |  1.15 ms |

A parent page is realistically 10-100 rows, so the `UNION ALL` tax stays under 3 ms, while the window at 50 parents over 100k children each reads 5M rows.

An index on the child's `(foreign key, sort columns)` makes each branch an index range-scan of exactly `$limit` rows. UQL does not create it, and neither Postgres nor UQL indexes a foreign key on its own.

## The Postgres arm

A `LATERAL` override on `PgLikeSqlDialect` - which is Postgres, CockroachDB, PGlite, Neon and bun-sql at once. Additive: `UNION ALL` is mandatory for the other three engines anyway, and stays the base. Measured end to end through the ORM, 600 parents over 60k children, wanting three each:

| parents | `LATERAL` | `UNION ALL` |
| ------: | --------: | ----------: |
|      10 |   0.96 ms |     1.15 ms |
|     100 |   1.09 ms |     3.82 ms |
|     500 |   2.12 ms |    17.58 ms |

Flat where the base is linear, and it buys two things.

- **9x on wide pages**, and flat rather than linear scaling (table above).
- **Constant SQL text.** `UNNEST($1::bigint[])` takes the whole key list as one parameter, so a single prepared statement serves every page size. `UNION ALL` cannot: N branches is distinct SQL per N.

It costs the `./postgres` entry 1,916 gzipped bytes, which is `schema/canonicalType` becoming reachable: `UNNEST` refuses an uncast parameter, so the row source has to spell the key's SQL type. Its budget rose from 24,500 to 27,000 by the rule `verify-dist.ts` states. There is no cheap way to take that back, and two that look like one are not:

- **Precomputing a field's canonical type at registration** puts `canonicalType` on the path of `entity/index.js`, which the root entry re-exports - so it adds the module to the entry every consumer loads to save part of it on one. The root reaches `abstractSqlDialect` but not `pgLikeSqlDialect`, which is why the cost is confined to `./postgres` today.
- **Splitting the module** by direction does not separate them: `fieldOptionsToCanonical`, the half the dialect needs, calls `sqlToCanonical` to read a `columnType: 'int'` string, so the parsing table comes along.

**Dispatch is inheritance, not a capability flag.** `AbstractSqlDialect` emits `UNION ALL`; `PgLikeSqlDialect` overrides. **MySQL supports `LATERAL` and must not use it** - measured at 38.3 ms on the viral page above, worse than its own `UNION ALL` at 3.9 ms and worse than N+1 at 15.8 ms, because MySQL does not plan it as a correlated index loop. A `supportsLateral` flag would invite exactly that mistake; an override leaves MySQL on the default with nothing to get wrong.

Composite keys use multi-argument `UNNEST`, which pairs the arrays rather than cross-producting them, on both Postgres and CockroachDB:

```sql
FROM UNNEST($1::bigint[], $2::text[]) AS p(a, b)
JOIN LATERAL (SELECT ... WHERE a = p.a AND b = p.b ORDER BY ... LIMIT ?) c ON true
```

Use the array form, not `VALUES`: Postgres types a bare parameter in a `VALUES` row source as `text`, so `(VALUES ($1),($2))` fails with `operator does not exist: bigint = text`. `UNNEST` needs the array's type spelled out too - an uncast parameter is `unknown` and it refuses with `function unnest(unknown) is not unique`. The type comes from the _parent's_ key column, which declares one explicitly, rather than from the child's foreign key, which would have to be resolved through the reference: a foreign key is spelled from the key it references, so the two always compare.

Rejected: deriving the row source from the child itself (`SELECT DISTINCT fk FROM child WHERE fk = ANY($1)`), which needs no cast because the comparison drives inference. It reintroduces exactly the cost that disqualifies the window - every matching child scanned to produce the distinct keys, since Postgres has no loose index scan - and measured 7.25 ms against `UNION ALL`'s 1.18 ms on the viral page.

## Decisions

- **The branches are wrapped derived tables, not bare parenthesised selects.** SQLite rejects `ORDER BY`/`LIMIT` on a bare compound branch (`near "(": syntax error`). The wrapped form works on all five and costs nothing: Postgres still plans each branch as an index scan of exactly `LIMIT` rows.
- **A non-total `$sort` throws**, the same rule [cursor pagination](roadmap.md) follows. Picking arbitrary rows among ties is the same failure as a keyset page that skips or repeats, and two adjacent features should not disagree about it.
- **`$skip` is a per-branch `OFFSET`**, with none of the `rn > skip AND rn <= skip + limit` arithmetic a window shape needs. It is honestly `parents x (skip + limit)` rows read, so a deep per-parent offset rides the same unbounded axis the window was rejected for. Acceptable because `$skip` is a number the caller typed; revisit with keyset arguments if it bites.
- **Pad the key list to a bucket size** on the `UNION ALL` path, with a sentinel key that matches nothing, so a ragged final page does not mint a one-off prepared statement. MySQL's `max_prepared_stmt_count` defaults to 16382. The `LATERAL` path needs none of this.
- **Composite parent keys become exact.** Each branch is `WHERE a = ? AND b = ?`. `parentsIn` deliberately over-selects on a composite key and leans on the regroup to drop mismatched pairings; per-branch equality removes that.
- **Many-to-many stops being a special case.** Each branch is a self-contained ordered query over the junction for one parent, so there is no cross-parent ordering to get wrong. That also settles an existing bug where `$sort` is left in the junction query while naming the target's columns.
- **No chunking.** Splitting the keys across several statements plans the same total and adds a round trip per chunk.
- **The internal plumbing does not touch `QueryOptions`.** The child load goes through a `protected` querier method that both backends override, mirroring the existing `internalFindMany` split. `QueryOptions` is public and surfaced on every method, so a partition key smuggled onto it would leak; MikroORM does exactly that behind a `@ts-ignore` and it is the thing to avoid.

**MongoDB uses `$unionWith`**, one bounded sub-pipeline per parent after the first, so a page is one round trip. Measured against MongoDB 7, 44k documents skewed 50 parents x 500 children, against the query-per-parent it replaces - which is N round trips, not N concurrent ones, since `execute` puts every operation through `serialize`:

| parents | `$unionWith` | a query each |
| ------: | -----------: | -----------: |
|      50 |       1.9 ms |      11.0 ms |
|     100 |       3.1 ms |      19.2 ms |
|     500 |      14.1 ms |      87.5 ms |

A query each is the fallback above it, and the only form a vector `$sort` takes at all: `$vectorSearch` has to be the first stage of a pipeline, so it cannot be one of N `$unionWith` branches, and read a parent at a time it stays correct because the search takes the parent's key as its own filter. The stage-count arm is covered by `mongoPerParentLimit.test.ts`; the vector arm is not, since `$vectorSearch` needs Atlas and the suite runs `mongodb-memory-server`.

Not the `$group`/`$push`/`$slice` MikroORM uses on MongoDB: that buffers every child of a parent into one array against the 16 MB document limit, which is the unbounded read this design rejects everywhere
else.

## Prior art

MikroORM 7.1 ships per-parent limiting and makes `limit` per-parent automatically with no opt-in flag, the same call made here. Its shape is `ROW_NUMBER() OVER (PARTITION BY ...)` with an outer rank filter, and on MongoDB a `$group`/`$push`/`$slice` that buffers every child of a parent into one array against the 16 MB document limit. Drizzle and Prisma use `LATERAL` where the dialect allows and JSON-aggregate the result; Prisma's own SQLite adapter declares `lateral: false`. Sequelize offers `separate: true`, a query per parent - the N+1 that batched population exists to prevent. TypeORM has nothing.

Rejected outright: the correlated `IN` with an inner `LIMIT`, which is Drizzle's SQLite path, is refused by both MySQL and MariaDB. Slicing each bucket in `putChildrenInParents` is the smallest possible change but transfers every child row.
