# Contributing to UQL

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
- **Code**: strict TypeScript, no `any`; `bun run lint` (Oxlint and Oxfmt) must pass. Prefer readable code over clever optimizations unless performance is the point.

## Packaging

- ESM-only, **zero runtime dependencies**. Adding one is a decision, not a convenience.
- Decorators need no consumer polyfill: `entity/decorator/bag.ts` fills in `Symbol.metadata` via `Symbol.for('Symbol.metadata')`.
- The CLI bundles **no transpiler**. `uql.config.ts` is loaded with a plain `import()`, so the caller supplies TypeScript support (`bun`, or `node --import tsx`). Deliberate: the config imports the entity classes, so the loader decides which decorator spec they run under, and only the runtime knows the project's `tsconfig.json`.

## Releasing

Maintainers follow the [release skill](.claude/skills/release/SKILL.md). Versioning and publishing are separate on purpose: `lerna version` bumps, tags and pushes, then `bun publish` publishes, since `lerna publish`'s npm step 404s unreliably against this registry. A failed publish never leaves a half-done release; rerun the publish alone.
