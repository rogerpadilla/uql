# Relations in one statement

A read is one statement on SQL and one aggregation pipeline on MongoDB. A to-one `$populate` is a `JOIN`; a to-many `$populate` and `$count` are correlated subqueries in the `SELECT`, aggregated as JSON, or `$lookup` sub-pipelines on MongoDB.

## Why

- **One snapshot**: two statements under `READ COMMITTED` can pair parents with children from different moments.
- **One path** for any nesting, paging, `$distinct` or stream.
- **Per-parent pages**: a relation's `$limit` applies to each parent.

## Shapes

A relation's rows are an ordinary read of the related entity, narrowed to the parent. Only the aggregate differs:

| Engine                | Aggregate                                                                         |
| :-------------------- | :-------------------------------------------------------------------------------- |
| Postgres, CockroachDB | `JSON_AGG(<row> ORDER BY ...)` over a derived table, each row whole via `LATERAL` |
| MySQL 8.0.14+         | `GROUP_CONCAT(JSON_OBJECT(...) ORDER BY ...)` over a derived table                |
| MariaDB               | `JSON_ARRAYAGG(JSON_OBJECT(...) ORDER BY ... LIMIT ...)` over the related table   |
| SQLite 3.44+          | `json_group_array(json_object(...) ORDER BY ...)` over a derived table            |
| Turso                 | the same, without `ORDER BY`                                                      |
| SQL Server            | `FOR JSON PATH`                                                                   |
| MongoDB               | `$lookup` running the relation's own pipeline                                     |

```sql
SELECT "User"."id", "User"."name",
  (SELECT COALESCE(JSON_AGG("_uql_row" ORDER BY "posts"."_uql_sort_createdAt" DESC), '[]'::json)
     FROM (SELECT "posts"."title", "posts"."createdAt", "posts"."createdAt" "_uql_sort_createdAt"
           FROM "Post" "posts"
           WHERE "posts"."title" ILIKE $1 AND "posts"."authorId" = "User"."id"
           ORDER BY "_uql_sort_createdAt" DESC LIMIT 5) "posts"
     CROSS JOIN LATERAL (SELECT "posts"."title", "posts"."createdAt") "_uql_row") "posts"
FROM "User"
WHERE "User"."name" ILIKE $2
LIMIT 20
```

- **Sort terms are carried out** as `_uql_sort_<path>` columns for the aggregate to order by, since a derived table's order is not guaranteed. A `$distinct` relation sorts only by what it selects.
- **MySQL** has no ordered `JSON_ARRAYAGG`, so it uses `GROUP_CONCAT`, whose 1 KB cap a `SET_VAR` hint lifts per statement.
- **MariaDB** cannot correlate a derived table, so it aggregates the related table directly and lifts the same cap with `SET STATEMENT`.
- **Postgres** reads each row whole: 5 to 25% faster than `JSON_BUILD_OBJECT`, with no argument limit.
- **Wide objects** split across nested calls where arguments are capped: 127 on SQLite before 3.48 (libSQL, Turso), 32 on D1.
- **A many-to-many** reads its targets through `IN (SELECT <target fk> FROM <junction> ...)`.
- **Under a join**, a to-many correlates to the join's alias; on MongoDB its lookup runs inside the join's.
- **Keys**: a joined row keeps its id, which alone tells a match from none. Nothing else is forced into a projection.
- **Aliases** are readable: the table name, relation key, junction table or join path, with `_2` on a clash.

## Types

JSON cannot hold a 64-bit integer, exact decimal, date or bytes, so these cross as text and the field decodes them:

| Column                  | Crosses JSON as                                   |
| :---------------------- | :------------------------------------------------ |
| integer, decimal, float | text; on SQLite, integers only                    |
| bytes                   | `\x` and hex                                      |
| date                    | ISO 8601 text; on SQL Server, UTC with its offset |
| vector                  | text, on Postgres                                 |

SQLite keeps a real as a number: 15 digits on 3.51 and libSQL, 17 on 3.53. A decimal declared `String` stays exact text.

## Measured

One statement ÷ 0.56.0's two, p50 of 300 rounds through each driver on Docker, round trip near 200 µs (SQL Server emulated, near 950 µs). Below 1 is faster; runs vary about 10%.

| One ÷ two statements    | 50 × 4 | 500 × 4 | 50 × 50 | top 5 of 200, × 20 |
| :---------------------- | -----: | ------: | ------: | -----------------: |
| Postgres 18             |   0.63 |    0.69 |    0.72 |               0.83 |
| CockroachDB 26.3        |   1.00 |    0.90 |    1.70 |               0.79 |
| MySQL 26.7              |   0.70 |    1.21 |    1.44 |               1.72 |
| MariaDB 12.3            |   0.68 |    0.87 |    1.07 |               2.72 |
| SQLite 3.53, in process |   1.10 |    1.14 |    0.88 |               0.64 |
| SQL Server 2025         |   0.78 |    1.38 |    1.96 |               0.68 |

- **A saved round trip wins over a network**, less so next to the database: on native Postgres (30 µs), 50 × 4 takes 200 µs against 176 µs.
- **The server builds the JSON**, so a wide fan-out costs more there: 1.4x on MySQL, 1.7x on CockroachDB, 2x on SQL Server.
- **Not taken**, each measured on the same data:
  - No numeric cast: 3 to 8% faster, but a `BIGINT` past 2^53 rounds.
  - Positional arrays, as Drizzle: 6 to 20% faster on wide reads only, needs each relation's keys, and SQL Server builds objects anyway.
  - `jsonb`, as Prisma: up to 1.7x slower on Postgres, 1.4 to 1.6x on SQLite.
  - A `LATERAL` join per relation: faster only on CockroachDB's 50 × 50, and missing on MariaDB and SQLite.
  - A `ROW_NUMBER` window: it sorts every child to keep the top few.
  - Skipping `group_concat_max_len`: the lift costs nothing (0.99 to 1.01), and without it a large array comes back cut.
  - MySQL's `JSON_ARRAYAGG` over ordered rows: no `ORDER BY` as of 26.7, and the subquery's order is lost.
  - Aggregating MySQL's related table directly: no faster (0.99 to 1.00), and it cannot page.

## Prerequisite: indexed foreign keys

The subquery looks children up per parent, so the migrator indexes every foreign key no index already leads with. Without one, 50 parents over 200k children took 318 ms against 22 ms on PG 18.

## Costs

- A child column is decoded by its entity; a pool's type parser does not reach it.
- The database builds the JSON, the hardest tier to scale.
- One value is capped: 1 GB on Postgres, `max_allowed_packet` on MySQL and MariaDB, 2 MB on D1, 16 MB on MongoDB.

## Prior art

Drizzle joins `LATERAL` and reads positional arrays. Prisma 7 builds `jsonb`. MikroORM pages with `ROW_NUMBER`.
