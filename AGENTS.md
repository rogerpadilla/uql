# Agent instructions

Canonical, tool-neutral instructions for this repo. Claude Code reads them via `CLAUDE.md` (`@AGENTS.md`); Cursor and other agents read this file directly. Repo-specific rules only - general coding preferences belong in each tool's user config.

## Verifying a change

- `bun run test`, `bun run ts`, `bun run lint.fix`.
- `bun run build` ends with `verify-dist.ts`, which checks every path `package.json` promises to
  consumers, keeps browser-facing entry graphs free of Node builtins, and enforces per-entry size budgets. Do not skip it by running `tsc` alone.
- `bun run test` runs vitest and then the Bun-runtime suites **sequentially on purpose**: both drive the same Docker databases through the same fixture tables, so running them concurrently corrupts each other's fixtures.

## Conventions

- New string-literal union values are camelCase (`'firstId'`, not `'first-id'`). Some older kebab literals predate this; they are public API, so ask before renaming them.
- Never narrow a find result by `$select`/`$exclude`/`$populate`. `QueryFindResult<E, Q>` stays the full entity, augmented only with vector `$sort` `$project` distance fields.

## Tests

- No conditionals in a test body. Where a shared suite covers backends with genuinely different specified behaviour, put the expectation in an overridable protected method on the suite (`expectedMixedBatchIds(...)`) or a per-family subclass (`MySqlLikeQuerierIt`), and keep the body linear.
- Shared suites run under **both** vitest and `bun:test`, so only use matchers both have. For "null or undefined" write `expect(x == null).toBe(true)`: vitest has `toBeNullable()`, bun has `toBeNil()`, neither has the other's. A missing SQL column hydrates to `null` while Mongo omits it as `undefined`, so that case is genuinely nullish.

## Packaging

- ESM-only with **zero runtime dependencies**. `reflect-metadata` is an optional peer; adding a hard dependency is a deliberate decision, not a convenience.
- Decorator-defined entities need the `reflect-metadata` polyfill; `defineEntity` needs nothing.
- The CLI bundles **no transpiler**. `uql.config.ts` is loaded with a plain `import()`, so whoever runs the CLI supplies TypeScript support (`bun`, or `node --import tsx`). That is deliberate: the config imports the entity classes, so the loader decides which decorator spec their decorators are called with, and only the runtime knows the project's `tsconfig.json`.

## Changelog
- Only put what worth it, keep described changes small for each release.
