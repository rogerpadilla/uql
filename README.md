<!-- ![code](/assets/code.webp 'code') -->

<a href="https://uql-orm.dev"><img src="assets/logo.svg" alt="uql" width="80" /></a>

[![tests](https://github.com/rogerpadilla/uql/actions/workflows/tests.yml/badge.svg)](https://github.com/rogerpadilla/uql/actions/workflows/tests.yml) [![Coverage Status](https://coveralls.io/repos/github/rogerpadilla/uql/badge.svg?branch=main)](https://coveralls.io/github/rogerpadilla/uql?branch=main) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/rogerpadilla/uql/blob/main/LICENSE) [![npm version](https://img.shields.io/npm/v/uql-orm.svg)](https://www.npmjs.com/package/uql-orm)

**[UQL](https://uql-orm.dev)** the only type-safe ORM with a single unified API for PostgreSQL, MySQL, SQLite, MariaDB, and MongoDB.

```ts
import { PgQuerierPool } from 'uql-orm/postgres';

const pool = new PgQuerierPool({ host: 'localhost', database: 'app' });

const users = await pool.withQuerier((q) =>
  q.findMany(User, {
    $select: { id: true, name: true },
    $populate: { profile: { $select: { bio: true } } },
    $where: { name: { $istartsWith: 'A' } },
    $limit: 10,
  }),
);
```

Full docs & API reference: **[uql-orm.dev](https://uql-orm.dev)**

---

## Why UQL?

- **One API, all databases** — `findMany`, `insertOne`, `aggregate` work identically against SQL and MongoDB. Switch dialects without changing code.
- **`HttpQuerier` for browser** call the same ORM API from the browser; queries serialize to HTTP. No API boilerplate.
- **Entity-first migrations** auto-generate migrations by diffing entities against the live database. `autoSync` for safe dev workflows.

## Supported databases

PostgreSQL (Neon, CockroachDB), MySQL, MariaDB, SQLite (better-sqlite3), MongoDB, LibSQL/Turso, Cloudflare D1, Bun SQL.

## Install

```sh
npm install uql-orm pg   # or mysql2, mariadb, better-sqlite3, mongodb, @libsql/client
```

---

Built with ❤️ and supported by **[Variability.ai](https://variability.ai)**.
