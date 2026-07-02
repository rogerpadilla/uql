# Contributing to UQL

First off, thank you for considering contributing to UQL! It's people like you who make this tool better for everyone.

## Getting Started

1. **Fork the repository** and create your branch from `main`.
2. **Install dependencies** using `bun install`.
3. **Run tests** to ensure a clean state: `bun test`.

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
- **Linting**: Run `bun run lint` (Biome) to ensure code style consistency.

## Coding Standards

- **TypeScript**: Strict typing is required. Avoid `any` whenever possible.
- **Formatting**: We use Biome for linting and formatting.
- **Simplicity**: KISS: Prefer readable, maintainable code over "clever" optimizations unless performance is the primary goal.

## Questions?
Feel free to open an issue or reach out via the community channels.
