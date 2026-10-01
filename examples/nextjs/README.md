# UQL with Next.js

A Server Component and a Route Handler querying SQLite through `node:sqlite`.

```sh
npm install
npx uql-migrate sync   # creates todos.db from src/entities.ts
npm run dev            # http://localhost:3000, and /api/todos
```

Two settings this depends on:

- `babel.config.json` compiles the decorators. Next's SWC compiles them by an older proposal unless `experimentalDecorators` is on, which uql's TC39 decorators do not work with.
- `@Entity({ name: 'todo' })` names the table, because the production build minifies class names.

`uql-migrate` runs `uql.config.ts` through the project's `tsx`.

Docs: https://uql-orm.dev/nextjs
