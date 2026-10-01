# Contributing to UQL

## Getting Started

1. **Fork the repository** and create your branch from `main`.
2. **Install dependencies** using `bun install`. `bun run build` also needs Node and Deno on the path: it runs the package on each.
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
- **A driver's package is named only inside its own entry**, in code and in types alike: `mongodb` in `mongo/`, `pg` in `postgres/`. Core reaches one structurally or through a dynamic `import()`, so a project without that driver compiles under `skipLibCheck: false`. `verify-dist`'s `checkPeerReach` holds it, and a new driver entry joins its `DRIVER_ENTRIES`.
- Decorators need no consumer polyfill: `entity/decorator/bag.ts` fills in `Symbol.metadata` via `Symbol.for('Symbol.metadata')`.
- `skills/` ships in the package beside the README, both copied in by `prepack`, so a user's `AGENTS.md` pointing at `node_modules/uql-orm/skills/uql-orm/SKILL.md` always reads the skill for their version.
- The CLI bundles **no transpiler**. On Node it imports `uql.config.ts` through the project's own `tsx` where one is installed (`tsImport`, namespaced, so a user's `--import tsx` cannot collide), and with a plain `import()` otherwise, as on Bun and Deno. Deliberate: the config imports the entity classes, so the project's loader decides which decorator spec they run under, reading the project's `tsconfig.json`.
- `examples/*` are workspace members, each a runnable app on one toolchain (Node, Bun, Next.js, Cloudflare D1). CI's `examples` job runs each one's `check` and `smoke` (schema, drift, then a write and a read over HTTP) against the built package. An example never defines `build`, so the root build stays on the libraries.

## Releasing

Maintainers follow the [release skill](.claude/skills/release/SKILL.md): `lerna version` tags, and [publish.yml](.github/workflows/publish.yml) publishes each tag to npm.
