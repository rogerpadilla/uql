# UQL on Node

A `node:http` server querying SQLite through `node:sqlite`, with no driver to install.

```sh
npm install
npx uql-migrate sync   # creates todos.db from src/entities.ts
npm run dev            # http://localhost:3102/todos
```

Node's type stripping does not run decorators, so `tsx` (a dev dependency) does: the server runs under it, and `uql-migrate` imports `uql.config.ts` through it.

Docs: https://uql-orm.dev/getting-started
