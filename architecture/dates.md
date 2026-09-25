# Dates

**One rule, on every SQL engine:** a `Date` is the instant it names, whichever zone the process, the session or the server runs in. It is bound as UTC, a timestamp without a zone is read as UTC, and a column keeps the milliseconds a `Date` holds.

The rule is one, the machinery is per engine, because each driver gets a different part of it wrong on its own. A new driver answers every row below.

| Where                | Postgres, CockroachDB                                      | MySQL, MariaDB                                                                    | SQLite family               | SQL Server                               |
| :------------------- | :--------------------------------------------------------- | :-------------------------------------------------------------------------------- | :-------------------------- | :--------------------------------------- |
| Column for `Date`    | `TIMESTAMPTZ`                                              | `DATETIME(3)`                                                                     | `TEXT`                      | `DATETIME2`                              |
| Bound value          | UTC text with `+00` (`normalizeValue`, array elements too) | UTC text (`normalizeValue`)                                                       | UTC text (`normalizeValue`) | a `Date` typed `DATETIME2` (querier)     |
| Inline literal       | UTC with `+00` (`escapePgSqlLiteral`)                      | UTC                                                                               | UTC                         | UTC                                      |
| Zoneless read        | `TIMESTAMP`, `DATE` as UTC (`wireTypes`, PGlite's parser)  | mysql2 `timezone: 'Z'`; MariaDB `dateStrings`, decoded by hydration               | hydration                   | the driver (`useUTC`)                    |
| Session              | untouched: a `TIMESTAMPTZ` needs none                      | `time_zone` UTC: mysql2 per connection, MariaDB's connector and Bun by themselves | none                        | none; `expr.now()` is `SYSUTCDATETIME()` |
| `expr.now()` default | `CURRENT_TIMESTAMP`                                        | `CURRENT_TIMESTAMP(n)`, the column's precision, which MySQL requires              | `CURRENT_TIMESTAMP`         | `SYSUTCDATETIME()`                       |

Text a row crossed JSON in, or a driver handed back as text, decodes through `decodeDate` (`util/date.ts`): UTC where it names no zone, its own offset where it does, and a bare `DATE` at UTC midnight, as `new Date('2026-09-10')` parses one. The Postgres pools and PGlite decode a `DATE` the same way, where their drivers would give local midnight.

## Why `TIMESTAMPTZ`, when uql reads a zoneless one as UTC anyway

Because uql is not the only reader. `now()`, a trigger, psql and every other client read and fill a `TIMESTAMP` in the session's zone. A `TIMESTAMPTZ` is an instant to all of them. It is also what MikroORM, Sequelize and Knex default to, and what the [PostgreSQL wiki](https://wiki.postgresql.org/wiki/Don't_Do_This#Don.27t_use_timestamp_.28without_time_zone.29) asks for.

A zoneless column stays available as `columnType: 'timestamp'`. uql binds and reads it as UTC, as Drizzle and Prisma do, but the database's own clock still fills it in the session's zone.

## Precision

`precision` on a date column is its fractional-second digits. An unstated one is the engine's default when compared (`defaultTimestampPrecision`: 6 on Postgres, 0 on MySQL, 7 on SQL Server), so drift sees a bare MySQL `DATETIME` as narrower than the `DATETIME(3)` a `Date` field declares. uql renders 3 on MySQL rather than 0 because MySQL rounds, not truncates: `.999` stored in whole seconds is the next second, an instant that has not happened. The same reason the wiki gives against `timestamp(0)`.

Introspection states a precision where uql's default differs from the engine's: always on MySQL, only a declared one on Postgres (`format_type`) and SQL Server, so `generate:from-db` writes `precision` only where it matters.

## Not done

- **SQLite stores text, not epoch numbers** as MikroORM and Drizzle's integer modes do: text keeps the `TEXT` column, sorts, and is what `CURRENT_TIMESTAMP`, `expr.now()`, triggers and uql's own literals already write.
- **The Postgres session is left alone**, where MySQL's is set: its default column needs none, and setting it would change what `::date` and `date_trunc` mean in a user's own SQL.
