# Agent instructions

Repo-specific rules, read directly by Claude Code, Cursor and other agents. General coding preferences belong in your tool's user config, not here.

## Conventions

- New string-literal union values are camelCase (`'firstId'`). Older kebab ones are public API: ask before renaming.
- **An engine states its shape; nothing branches on its name.** A capability shared code branches on is a `dialect.features` key, which every engine answers. A spelling is a member of the dialect, defaulting to ANSI. DDL data only `migrate/` or `schema/` reads is an entry in a table there keyed by dialect name and total over it (`ENGINE_TYPES`, `DIALECT_DEFAULTS`), which keeps it out of the driver entries.
- **A find result is narrowed to what the query projected, at every depth** (`QueryFindResult<E, Q>`). A read captures its whole query as `Q`, typed `Captured<Concrete, Q>`: inference sees the literal, while the parameter is the concrete query type, so excess-property checks still catch a typo'd key at any depth, which a bare `Q` would not. `aggregate` captures its query the same way, for `QueryAggregateResult<E, Q>`. A write's `returning` is flat, so it stays a key set (`S`, `V`): measured, that is cheaper than capturing the map. Pinned in `queryFindResult.test-d.ts` and `queryAggregate.test-d.ts`; the typo errors it must keep, in `queryInput`, `queryPopulate` and `queryCount.test-d.ts`. Its cost per call is in `bun run ts.perf`: an alias or conditional added to `QueryFindResult` or `ShapedRow` is paid on every read.
- **A query is data a client can send over the network**: plain JSON at every depth, never a function, class instance or symbol, so the same query runs on the server and from the browser. Callbacks and refs belong to definitions, which never travel. A design that needs one inside a query is a definition, not a query feature.
- **A query type's `Sql` is the SQL its transport can carry**: `QuerySql` on the server, `never` on the wire (`WireQuery<E>` is `Query<E, never>`; `SharedQuerier` reads it with `QuerierSql<W>`). `Sql` comes right after the subject (`QueryWhere<E, Sql, K>`). `wireJson` is its run-time guard. Pinned in `clientQuerier.test-d.ts`.
- **A member is never named by a string.** A statement names one by a key (`$sum: { amount: true }`); a definition reads one off a map: `RefMap<E>` for SQL, `IndexRefMap<E>` for indexes, a JSON column's paths included (`indexes: (post, index) => [index([post.title, post.meta.lang])]`), `KeyMap<E>` for relations and methods (`mappedBy: (post) => post.author`). A ref's own members are symbols (`REF_KEY`), but for the methods its types keep off the data's keys (`as`, the aggregates). Strings stay only where names are data: the migration builder, and a schema built from data at run time.
- **A map keyed by an entity's members is declared over a parameter constrained to `keyof E`** (`QuerySelect<E, F extends keyof E = FieldKey<E>>`), which keeps rename and find-references linked. A map over a computed key set type-checks the same and loses the link: `bun run ts.rename` catches it, `tsc` cannot.
- **Both call forms stay**: the entity first, or as the query's `$entity`. The second is public API by decision, so do not propose dropping it, whatever it costs in overloads.
- **An entity of unknown type is `object`** (`Type<object>`, `EntityMeta<object>`): never `unknown`, and `any` only in the registry map in `definition.ts`.
- **An alias a statement invents is `_uql`-prefixed and a constant** beside the code that owns it, so its writer and reader cannot drift. Two exceptions: tables, which `QueryContext.claimAlias` names, and `RETURNED_ID`, the `id` a raw `run()` reports ids under too.
- **Wide integers stay exact.** Every driver decodes a BIGINT through `decodeWideNumber` (a number where exact, its text past 2^53), and a `bigint` reaches the driver as it is. MongoDB keeps a `bigint` only for a `BigInt` field; D1 answers a plain number and is sent text. Held by `shouldReadAWideIntegerExactly` and `shouldWriteAWideBigIntExactly`.
- **A column default is a literal or an `SqlExpression`** at every layer, introspection included, never SQL held in a string.
- **`strict` is the floor; `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` stay off**, measured: both would be paid in `!` for distinctions nothing here draws.
- **A public API change updates [`skills/uql-orm/SKILL.md`](skills/uql-orm/SKILL.md)** in the same change, where the skill shows or names it: it is what a user's coding agent writes UQL from.

## Verifying a change

- `bun run check` is the gate: `lint`, `ts`, `ts.rename`, `test`, `build` and `check.package`, which inspects `dist` and so needs the build. `bun run lint.fix` fixes instead of reporting.
- `build` ends with `verify-dist.ts`: declared paths, browser entries free of Node builtins, types resolving with `types: []`, the `ts.perf` fixture (`scripts/typeFixture.ts`) compiling as a consumer, `smoke.mjs` on Node and Bun with no driver, gzipped size budgets. Raise a budget only once you know which module became reachable.
- `bun run test` runs vitest then Bun **sequentially on purpose**: both drive the same Docker databases. Never pipe a test run into `head`, whose SIGPIPE leaves forks alive; redirect to a file.
- `bun run ts.perf [calls] [version]` measures what the types cost a consumer, on `dist` (build first), beside a published version when one is given. Compare instantiations, not wall clock.

## Tests

- A shared suite covering backends that behave differently keeps its body linear: the expectation goes in an overridable method (`expectedMixedBatchIds(...)`) or a per-family subclass (`MySqlLikeQuerierIt`).
- Shared suites run under vitest and `bun:test`, so use matchers both have. For "null or undefined" write `expect(x == null).toBe(true)`: SQL hydrates a missing column to `null`, MongoDB to `undefined`.
- An integration suite acquires a querier per test and `end()`s its pool in `afterAll`: a pinned querier can hold a connection the server closed.
- A suite running DDL across engines takes a database of its own on each server (`sqlPools(database)`, or one file per engine on that database), declared in each `docker/init-*.sql`: files changing one database collide. SQL Server deadlocks, Postgres fails a scan reprinting a trigger another drops, and CockroachDB keeps functions in the schema descriptor every transaction reads. `syncedPool` gives a suite its entities' tables, created before and dropped after.
- `planSync()` is safe and holds every alter, so assert "no drift" with `planSync({ safe: false })`.

## Elsewhere

[architecture/](architecture/) holds the design docs: [roadmap.md](architecture/roadmap.md) is the build order, and a file per feature that needed a design settled before it was written.

[CONTRIBUTING.md](CONTRIBUTING.md#packaging) holds the packaging constraints (ESM-only, **zero runtime dependencies**, no transpiler in the CLI) for human contributors. Cutting a release is the `release` skill - a tag push publishes from CI, so never publish from a machine, `lerna publish` included.
