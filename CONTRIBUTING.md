# Contributing to UQL

First off, thank you for considering contributing to UQL! It's people like you who make this tool better for everyone.

## Getting Started

1. **Fork the repository** and create your branch from `main`.
2. **Install dependencies** using `bun install`.
3. **Start the databases**: `docker compose up -d --wait`.
4. **Run tests** to ensure a clean state: `bun run test`.

## How to Contribute

### Bug Reports

Open an issue and include:

- A clear description of the bug.
- Steps to reproduce (a minimal reproduction case is highly appreciated).
- Your environment (Node/Bun version, OS, Database used).

### Feature Requests

Open an issue describing the desired behavior and the "why" behind it. We prefer detailed proposals over "add X feature" requests.

### Pull Requests

- **Small, focused PRs**: Keep changes atomic.
- **Commit Messages**: Use conventional commits (e.g., `feat: add X`, `fix: resolve Y`).
- **Testing**: Ensure all tests pass and add new tests for any new functionality.
- **Linting**: Run `bun run lint` (Oxlint and Oxfmt) to ensure code style consistency.

## Coding Standards

- **TypeScript**: Strict typing is required. Avoid `any` whenever possible.
- **Formatting**: We use Oxlint for linting and Oxfmt for formatting.
- **Simplicity**: KISS: Prefer readable, maintainable code over "clever" optimizations unless performance is the primary goal.

## Packaging

- ESM-only, **zero runtime dependencies**. Adding one is a decision, not a convenience.
- Decorators need no consumer polyfill: `entity/decorator/bag.ts` fills in `Symbol.metadata` via `Symbol.for('Symbol.metadata')`.
- The CLI bundles **no transpiler**. `uql.config.ts` is loaded with a plain `import()`, so the caller supplies TypeScript support (`bun`, or `node --import tsx`). Deliberate: the config imports the entity classes, so the loader decides which decorator spec they run under, and only the runtime knows the project's `tsconfig.json`.

## Releasing

Versioning and publishing are separate on purpose: `lerna publish`'s npm step 404s unreliably against this registry, so `lerna` bumps/tags/pushes and `bun publish` publishes. A failed publish therefore never leaves a half-done release - the tag and CHANGELOG are already right, and re-running costs nothing.

- Keep the changelog.md very concise, short (only put what worth it for end-users), human, clear, and concrete. Newest first, `[yyyy-mm-dd]`. Headed with the version the bump will produce; nothing checks that the two agree - not one line per commit.
- `bun run release.patch` (`.minor`/`.major`) runs `check`, `lerna version`, `git push --follow-tags`, `release.github`. The `lerna version` prompt is kept on purpose - a non-interactive shell needs `bun run release patch --yes`, then push tags separately.
- `release.github` opens the GitHub Release from the CHANGELOG entry (a tag alone notifies nobody). Idempotent, and it throws when the entry is missing. The codemod is deliberately not released.
- Then `bun run publish.orm` / `publish.codemod` for whichever package `lerna version` reported as changed. Each package's `prepack` builds first, so `dist` cannot lag the version being published. Re-publishing an existing version exits non-zero, so the exit code can be trusted.
- npm auth needs no setup: `.npmrc` holds the `${NPM_ACCESS_TOKEN}` placeholder and the token lives in the gitignored `.env` that `bun run` loads. Anything invoking `npm` outside `bun` must export it.

## Questions?

Feel free to open an issue or reach out via the community channels.
