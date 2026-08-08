# Agent instructions

Canonical, tool-neutral instructions for this repo, read directly by Cursor and through `CLAUDE.md`. Repo-specific rules only: general coding preferences belong in each tool's user config.

## Verifying a change

- `bun run check` is the gate: `lint`, `ts`, `test`, `build`, `check.package`. `build` belongs in it because `check.package` inspects `dist`, so without one the gate validates the previous release's output and passes. `bun run lint.fix` fixes formatting instead of only reporting it.
- `build` ends with `verify-dist.ts`: every path `package.json` promises is present, browser entry graphs stay free of Node builtins, and no entry exceeds its size budget. `DIST_BYTES_BUDGET` counts declarations, so JSDoc spends it and raising it for documentation is expected; a *per-entry* budget moving is the leaked-module case the budgets exist to catch.
- `bun run test` runs vitest then the Bun suites **sequentially on purpose**: both drive the same Docker databases through the same fixture tables. Anything else touching them concurrently corrupts them, including an orphaned worker from an earlier run, so never pipe a test run into `head` - the SIGPIPE kills the parent and leaves its forks alive. Redirect to a file and read that.

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

Versioning and publishing are two separate steps, deliberately: `lerna publish`'s own npm-publish step
404s unreliably against the registry here regardless of `npmClient`, so `lerna` only bumps/tags/pushes
and `bun publish` does the actual publish, per package.

- Write the CHANGELOG entry first, with the heading set to the version the bump will produce: nothing checks that the two agree. Keep it to the changes worth a reader's time, not one line per commit.
- `bun run release.patch` (or `.minor` / `.major`) does `build`, `check.package`, `lerna version`, `git push --follow-tags`. It does **not** run the tests, so `bun run check` first. `lerna version` prompts, which a non-interactive shell cannot answer: use `bun run release patch --yes` and push the tags separately.
- Then publish whichever package(s) `lerna version` reported as changed: `bun run publish.orm` / `bun run publish.codemod` (each is just `cd packages/<name> && bun publish`). `bun publish` exits `0` even when the registry rejects a republish of an already-published version, so read its output rather than trust the exit code - a real failure looks the same on the surface as a correct no-op skip.
- npm auth needs no setup: `.npmrc` holds only the `${NPM_ACCESS_TOKEN}` placeholder and the token lives in the gitignored `.env` that `bun run` loads. Anything invoking `npm` outside `bun` has to export it.
- Because versioning and publishing are separate, a failed publish never leaves the release half-done the way a combined step would: the tag and CHANGELOG are already correct, and re-running `bun run publish.orm` costs nothing.
