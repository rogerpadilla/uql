# UQL on Bun

`Bun.serve` querying SQLite through `bun:sqlite`. Bun runs the TypeScript and its decorators natively (Bun 1.3.10+).

```sh
bun install
bun --bun uql-migrate sync   # creates todos.db from src/entities.ts
bun run dev                  # http://localhost:3103/todos
```

`--bun` runs the CLI on Bun rather than the Node its shebang names, so it opens the database through `bun:sqlite`.

Docs: https://uql-orm.dev/sqlite
