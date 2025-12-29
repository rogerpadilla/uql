# @uql/migrate

Database migration system for [uql](https://uql.app) ORM.

## Features

- 🔄 **Version-controlled migrations** - Track and manage database schema changes
- 📝 **Auto-generated migrations** - Generate migrations from entity definitions
- 🔀 **Multi-database support** - PostgreSQL, MySQL, MariaDB, SQLite
- 💾 **Database-backed storage** - Track migration state in your database
- 🛠️ **CLI tool** - Easy-to-use command-line interface
- 🔍 **Schema introspection** - Compare entity definitions with actual database schema

## Installation

```bash
npm install @uql/migrate uql
# Plus your database adapter
npm install uql-postgres pg
```

## Quick Start

### 1. Create Configuration

Create a `uql.config.ts` file in your project root:

```typescript
import { PgQuerierPool } from 'uql-postgres';
import { User, Post } from './src/entities/index.js';

export default {
  querierPool: new PgQuerierPool({
    host: 'localhost',
    user: 'postgres',
    password: 'postgres',
    database: 'myapp',
  }),
  migrationsPath: './migrations',
  dialect: 'postgres',
  entities: [User, Post],
};
```

### 2. Generate a Migration

```bash
# Create an empty migration
npx @uql/migrate generate add_users_table

# Or generate from entity definitions
npx @uql/migrate generate:entities initial_schema
```

### 3. Write Migration Logic

Edit the generated file in `./migrations/`:

```typescript
import type { Querier } from '@uql/core/type';

export default {
  async up(querier: Querier): Promise<void> {
    await (querier as any).run(`
      CREATE TABLE "User" (
        "id" SERIAL PRIMARY KEY,
        "name" VARCHAR(255) NOT NULL,
        "email" VARCHAR(255) UNIQUE NOT NULL,
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  },

  async down(querier: Querier): Promise<void> {
    await (querier as any).run(`DROP TABLE IF EXISTS "User"`);
  },
};
```

### 4. Run Migrations

```bash
# Run all pending migrations
npx @uql/migrate up

# Check status
npx @uql/migrate status

# Rollback last migration
npx @uql/migrate down
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `up` | Run all pending migrations |
| `up --step 1` | Run only the next migration |
| `up --to <name>` | Run migrations up to specified name |
| `down` | Rollback the last migration |
| `down --step 3` | Rollback last 3 migrations |
| `down --all` | Rollback all migrations |
| `status` | Show migration status |
| `pending` | List pending migrations |
| `generate <name>` | Create empty migration file |
| `generate:entities <name>` | Generate migration from entities |
| `sync` | Sync schema directly (dev only!) |
| `sync --force` | Drop and recreate all tables |

## Programmatic Usage

```typescript
import { Migrator, PostgresSchemaGenerator } from '@uql/migrate';
import { PgQuerierPool } from 'uql-postgres';

const pool = new PgQuerierPool({ /* ... */ });
const migrator = new Migrator(pool, {
  migrationsPath: './migrations',
  logger: console.log,
});

migrator.setSchemaGenerator(new PostgresSchemaGenerator());

// Run migrations
await migrator.up();

// Check status
const status = await migrator.status();
console.log('Pending:', status.pending);
console.log('Executed:', status.executed);

// Generate migration
await migrator.generate('add_users_table');
```

## Entity Schema Options

Use the new schema properties in your entity definitions:

```typescript
import { Entity, Field, Id } from '@uql/core/entity';

@Entity()
export class User {
  @Id()
  id?: number;

  @Field({
    length: 100,        // VARCHAR(100)
    nullable: false,    // NOT NULL
  })
  name?: string;

  @Field({
    unique: true,       // UNIQUE constraint
    index: true,        // Create index
  })
  email?: string;

  @Field({
    columnType: 'text', // Explicit column type
  })
  bio?: string;

  @Field({
    columnType: 'decimal',
    precision: 10,
    scale: 2,
  })
  balance?: number;

  @Field({
    defaultValue: true,
  })
  isActive?: boolean;

  @Field({
    comment: 'UTC timestamp of account creation',
  })
  createdAt?: Date;
}
```

## Supported Column Types

| Type | PostgreSQL | MySQL | SQLite |
|------|------------|-------|--------|
| `int` | INTEGER | INT | INTEGER |
| `smallint` | SMALLINT | SMALLINT | INTEGER |
| `bigint` | BIGINT | BIGINT | INTEGER |
| `serial` | SERIAL | INT AUTO_INCREMENT | INTEGER AUTOINCREMENT |
| `float` | DOUBLE PRECISION | FLOAT | REAL |
| `decimal` | NUMERIC(p,s) | DECIMAL(p,s) | REAL |
| `boolean` | BOOLEAN | TINYINT(1) | INTEGER |
| `varchar` | VARCHAR(n) | VARCHAR(n) | TEXT |
| `text` | TEXT | TEXT | TEXT |
| `uuid` | UUID | CHAR(36) | TEXT |
| `timestamp` | TIMESTAMP | TIMESTAMP | TEXT |
| `json` | JSON | JSON | TEXT |
| `jsonb` | JSONB | JSON | TEXT |
| `vector` | VECTOR(n) | JSON | TEXT |

## License

MIT

