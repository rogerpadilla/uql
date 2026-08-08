# Agent instructions

Canonical, tool-neutral instructions for this repo, read directly by Cursor and through `CLAUDE.md`. Repo-specific rules only: general coding preferences belong in each tool's user config.

## Verifying a change

- `bun run check` is the gate: `lint`, `ts`, `test`, `build`, `check.package`. Use `bun run lint.fix` when you want the formatting fixed rather than only reported.
- `build` is in that list because `check.package` reads `dist`: `publint` and `attw --pack` both inspect the built package, so without a build first the gate validates the *previous* release's output and reports it as passing.
- `bun run build` ends with `verify-dist.ts`, which checks every path `package.json` promises to consumers, keeps browser-facing entry graphs free of Node builtins, and enforces per-entry size budgets. Do not skip it by running `tsc` alone.
- `DIST_BYTES_BUDGET` in `verify-dist.ts` counts declarations, so JSDoc on an exported symbol spends it. Raising it for documentation is expected; raising it because a *per-entry* budget also moved is not, since that is the leaked-module case the budgets exist to catch.
- `bun run test` runs vitest and then the Bun-runtime suites **sequentially on purpose**: both drive the same Docker databases through the same fixture tables, so running them concurrently corrupts each other's fixtures.

## Conventions

- New string-literal union values are camelCase (`'firstId'`, not `'first-id'`). Some older kebab literals predate this; they are public API, so ask before renaming them.
- Never narrow a find result by `$select`/`$exclude`/`$populate`. `QueryFindResult<E, Q>` stays the full entity, augmented only with vector `$sort` `$project` distance fields.

## Tests

- No conditionals in a test body. Where a shared suite covers backends with genuinely different specified behaviour, put the expectation in an overridable protected method on the suite (`expectedMixedBatchIds(...)`) or a per-family subclass (`MySqlLikeQuerierIt`), and keep the body linear.
- Shared suites run under **both** vitest and `bun:test`, so only use matchers both have. For "null or undefined" write `expect(x == null).toBe(true)`: vitest has `toBeNullable()`, bun has `toBeNil()`, neither has the other's. A missing SQL column hydrates to `null` while Mongo omits it as `undefined`, so that case is genuinely nullish.

## Packaging

- ESM-only with **zero runtime dependencies**; adding one is a deliberate decision, not a convenience.
- Decorators need no polyfill from the consumer. `Symbol.metadata` is the one thing missing from the runtimes we support, and `entity/decorator/bag.ts` fills it in with `Symbol.for('Symbol.metadata')`.
- The CLI bundles **no transpiler**. `uql.config.ts` is loaded with a plain `import()`, so whoever runs the CLI supplies TypeScript support (`bun`, or `node --import tsx`). That is deliberate: the config imports the entity classes, so the loader decides which decorator spec their decorators are called with, and only the runtime knows the project's `tsconfig.json`.

## Releasing

- Write the CHANGELOG entry first, with the heading set to the version the bump will produce: nothing checks that the two agree. Keep it to the changes worth a reader's time, not one line per commit.
- `bun run release.patch` (or `.minor` / `.major`) does the rest: `build`, `check.package`, `lerna publish`, `git push --follow-tags`. It does **not** run the tests, so `bun run check` first.
- npm auth needs no setup: `.npmrc` holds only the `${NPM_ACCESS_TOKEN}` placeholder and the token itself lives in the gitignored `.env`, which `bun run` loads automatically. Anything invoking `npm` outside `bun` has to export it.
- `lerna publish` prompts for confirmation, which a non-interactive shell cannot answer: use `bun run release patch --yes`, then `git push --follow-tags` separately.
- **If the publish fails, the release is already half-done.** `lerna` bumps the version, commits and pushes the tag *before* it publishes, so a failure there leaves the repo released and npm not. Do not bump again: that burns a version and leaves the tag pointing at nothing published. Recover with `bun run release.current` (`lerna publish from-package`), which publishes whatever version is on disk.
- `lerna` writes a `gitHead` field into `packages/uql-orm/package.json` while packing and never removes it, which used to make the *next* run die with `EUNCOMMIT`. `postpack` deletes the key now, alongside the `README.md` it copies in for the tarball, so this cleans itself up whether the publish succeeds or fails. It deletes only that key rather than reverting the file, so an unrelated edit is not silently discarded.
