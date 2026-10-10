# Dates

**One rule, on every SQL engine:** a `Date` is the instant it names, whichever zone the process, the session or the server runs in. It is bound as UTC, a timestamp without a zone is read as UTC, and a column keeps the milliseconds a `Date` holds.

The rule is one, the machinery is per engine, because each driver gets a different part of it wrong on its own. A new driver answers every row below.

| Where              | Postgres, CockroachDB                                      | MySQL, MariaDB                                                                     | SQLite family                                  | SQL Server                            |
| :----------------- | :--------------------------------------------------------- | :--------------------------------------------------------------------------------- | :--------------------------------------------- | :------------------------------------ |
| Column for `Date`  | `TIMESTAMPTZ(3)`                                           | `DATETIME(3)`                                                                      | `TEXT`                                         | `DATETIME2(3)`                        |
| Bound value        | UTC text with `+00` (`normalizeValue`, array elements too) | UTC text (`normalizeValue`)                                                        | UTC text (`normalizeValue`)                    | a `Date` typed `DATETIME2` (querier)  |
| Inline literal     | UTC with `+00` (`escapePgSqlLiteral`)                      | UTC                                                                                | UTC                                            | UTC                                   |
| Zoneless read      | `TIMESTAMP`, `DATE` as UTC (`wireTypes`, PGlite's parser)  | mysql2 `timezone: 'Z'`; MariaDB `dateStrings`, decoded by hydration                | hydration                                      | the driver (`useUTC`)                 |
| Session            | untouched: a `TIMESTAMPTZ` needs none                      | `time_zone` UTC: mysql2 per connection, MariaDB's connector and Bun by themselves  | none                                           | none; its clock is `SYSUTCDATETIME()` |
| `currentTimestamp` | `CURRENT_TIMESTAMP`                                        | `CURRENT_TIMESTAMP(3)`; as a default, the column's precision, which MySQL requires | `strftime(...)`, the text a bound `Date` takes | `SYSUTCDATETIME()`                    |

Text a row crossed JSON in, or a driver handed back as text, decodes through `decodeDate` (`util/date.ts`): UTC where it names no zone, its own offset where it does, and a bare `DATE` at UTC midnight, as `new Date('2026-09-10')` parses one. The Postgres pools and PGlite decode a `DATE` the same way, where their drivers would give local midnight.

## Why `TIMESTAMPTZ`, when uql reads a zoneless one as UTC anyway

Because uql is not the only reader. `now()`, a trigger, psql and every other client read and fill a `TIMESTAMP` in the session's zone. A `TIMESTAMPTZ` is an instant to all of them. It is also what MikroORM, Sequelize and Knex default to, and what the [PostgreSQL wiki](https://wiki.postgresql.org/wiki/Don't_Do_This#Don.27t_use_timestamp_.28without_time_zone.29) asks for.

A zoneless column stays available as `columnType: 'timestamp'`. uql binds and reads it as UTC, as Drizzle and Prisma do, but the database's own clock still fills it in the session's zone.

## Precision

`precision` on a date column is its fractional-second digits. A field stating none declares 3 on every engine (`DATE_PRECISION`), the milliseconds a `Date` holds, so a value the database writes itself, a `currentTimestamp` default or a stamp, reads back as exactly what is stored. Postgres's 6 and SQL Server's 7 would keep digits a `Date` drops, and MySQL's 0 rounds, not truncates: `.999` stored in whole seconds is the next second, an instant that has not happened. The same reason the wiki gives against `timestamp(0)`. A `sql` column type is the SQL itself and is left as written.

A column stating none holds the engine's own (`defaultTimestampPrecision`: 6 on Postgres, 0 on MySQL, 7 on SQL Server), and introspection reads it as that, so drift sees a bare `TIMESTAMPTZ` as wider than the `TIMESTAMPTZ(3)` a `Date` field declares, and `generate:from-db` writes the `precision` the column has, unless it is the 3 a field states by stating none.

## Not done

- **SQLite stores text, not epoch numbers** as MikroORM and Drizzle's integer modes do: text keeps the `TEXT` column, sorts, and is what `currentTimestamp`, triggers and uql's own literals write.
- **The Postgres session is left alone**, where MySQL's is set: its default column needs none, and setting it would change what `::date` and `date_trunc` mean in a user's own SQL.
