# Agent instructions

Repo-specific rules, read by Cursor directly and by Claude through `CLAUDE.md`. General coding preferences belong in your tool's user config, not here.

## Conventions

- New string-literal union values are camelCase (`'firstId'`). Older kebab ones are public API - ask before renaming.
- **A find result is narrowed to what the query projected** (`QueryFindResult`), and the projection is captured as _key sets_ - `$select`/`$exclude` field names plus the map's value, `$populate` and `$count` relation names - never as the maps themselves. TypeScript skips excess-property checking on a naked type parameter, so a captured map would swallow a typo'd key inside it, where a captured key set fails its own `FieldKey`/`RelationKey` constraint. Never capture `$where`, `$sort` or a relation's own query. Shape pinned in `queryFindResult.test-d.ts`; the typo'd-key errors it must not cost, in `queryInput.test-d.ts`, `queryPopulate.test-d.ts` and `queryCount.test-d.ts`.
- **An alias a statement invents is `_uql`-prefixed and declared as a constant**, beside the code that owns it. The prefix keeps it off a user's column; the constant keeps the ends that write and read it from drifting, which nothing would fail on. A table is the exception: it reads under its own name, its join's path or its relation's name, through `QueryContext.claimAlias`, which suffixes one only where another table of the statement took it.
- A vector `$sort` `$project` distance field is not inferred - annotate with `WithDistance<E, K>`.
- **Every driver decodes a BIGINT by `decodeWideNumber`** (`util/wideNumber.ts`): a number where one is exact, the exact text past 2^53, never a rounded number. A new driver wires it at the wire - a type parser, a driver option, or `decodeBigInts` - and the shared suite's `shouldReadAWideIntegerExactly` holds it there. The SQLite family is the one exception, pinned per driver.
- **A `bigint` reaches the driver as it is**: `normalizeValue` never makes one a number, since every driver binds it exactly; one that refuses it (D1) sends its text. `shouldWriteAWideBigIntExactly` holds it, on every SQL engine.
- **`strict` is the floor; `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` stay off** - measured, not assumed. EOPT breaks the querier hierarchy for a distinction nothing here draws: option objects are spread together and defaulted with `??`. NUIA lands 314 of its 419 errors in tests indexing their own fixtures. Both would be paid in `!`.
- Only put comments when really necessary, and if so, be pretty concise.

## Verifying a change

- `bun run check` is the gate: `lint`, `ts`, `test`, `build`, `check.package`. `build` is in it because `check.package` inspects `dist`, so without one the gate passes on the previous release's output. `bun run lint.fix` fixes instead of reporting.
- `build` ends with `verify-dist.ts`: declared paths present, browser entries free of Node builtins, types resolving with `types: []`, gzipped size budgets. A budget moving is the leaked-module case it exists to catch - raise one only once you know which module became reachable.
- `bun run test` runs vitest then the Bun suites **sequentially on purpose**: both drive the same Docker databases. Never pipe a test run into `head` - the SIGPIPE kills the parent and leaves its forks alive, corrupting the next run. Redirect to a file.
- `bun run ts.perf` reports what the types cost a consuming project, split into fixed and per-query. It measures `dist`, so **build first** - including in the worktree when measuring a before (`git worktree add <dir> uql-orm@<version>`). It fails rather than reporting a number when the measured project does not compile. Instantiations compare across runs; the wall clock does not. Measure both sides of a query-type change in one session. Baseline at 0.45.1: **4,163** fixed, **99,214** at 600 queries.

## Tests

- Where a shared suite covers backends with different specified behaviour, keep the body linear: put the expectation in an overridable method (`expectedMixedBatchIds(...)`) or a per-family subclass (`MySqlLikeQuerierIt`).
- Shared suites run under **both** vitest and `bun:test`, so use only matchers both have. For "null or undefined" write `expect(x == null).toBe(true)` - vitest has `toBeNullable()`, bun has `toBeNil()`, neither has the other's. A missing SQL column hydrates to `null`, Mongo omits it as `undefined`.
- An integration suite acquires per test and `end()`s its pool in `afterAll`. Never pin one querier for a whole suite: a pool can hand out a connection the server already closed.

## Elsewhere

[architecture/](architecture/) holds the design docs: [roadmap.md](architecture/roadmap.md) is the build order, and a file per feature that needed a design settled before it was written.

[CONTRIBUTING.md](CONTRIBUTING.md#packaging) holds the packaging constraints (ESM-only, **zero runtime dependencies**, no transpiler in the CLI) for human contributors. Cutting a release is the `release` skill - versioning and publishing are two separate steps on purpose, so never reach for `lerna publish`.
