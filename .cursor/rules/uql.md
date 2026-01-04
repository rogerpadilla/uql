---
description: Rules and best practices for developing with the UQL ORM framework.
globs: ["**/*.ts", "**/*.js"]
---

# UQL (Universal Query Language) Best Practices

You are an expert in the UQL ORM framework. When writing code that uses UQL, follow these patterns and conventions.

## 1. Entity Definition
Entities are the core of UQL. Always use the following decorators from `@uql/core`:

- **@Entity()**: Use on classes to mark them as database entities.
- **@Id()**: Every entity must have exactly one primary key. Use `onInsert` for generating IDs (e.g., `uuidv7`).
- **@Field()**: Use for regular columns.
- **@OneToOne(), @OneToMany(), @ManyToOne(), @ManyToMany()**: Use for defining relations.

### Example Entity:
```typescript
import { Entity, Id, Field, ManyToOne } from '@uql/core';
import { v7 as uuidv7 } from 'uuid';
import { Company } from './Company';

@Entity()
export class User {
  @Id({ onInsert: uuidv7 })
  id?: string;

  @Field()
  name?: string;

  @Field({ unique: true })
  email?: string;

  @ManyToOne({ type: () => Company })
  company?: Company;
}
```

## 2. Querying
UQL provides two main ways to interact with the database: **Repositories** and **Queriers**.

- **Repository**: High-level, type-safe API for a specific entity. Recommended for most cases.
- **Querier**: Low-level API for transactions and complex cross-entity operations.

### Using Repositories:
```typescript
const repo = repository(User);

// Find users with a specific name
const users = await repo.find({
  filter: { name: 'John' },
  relations: ['company']
});

// Create a new user
await repo.insert({ name: 'Alice', email: 'alice@example.com' });
```

## 3. Query Syntax (Consistent across dialects)
UQL uses a MongoDB-inspired syntax that works across PostgreSQL, MySQL, SQLite, and MongoDB.

- Use `$eq`, `$gt`, `$lt`, `$in`, `$not`, etc., for filtering.
- Nested objects in filters represent relations.

## 4. Common Hallucinations (Prevent Errors)
When generating UQL code, **NEVER** use patterns from other ORMs. Be strict about these differences:

- **❌ DO NOT use `@Column()`**: UQL uses **`@Field()`**.
- **❌ DO NOT use `@PrimaryGeneratedColumn()`**: UQL uses **`@Id()`** with an `onInsert` handler.
- **❌ DO NOT use `@CreatedAt` or `@UpdatedAt`**: UQL handles these via **`@Field({ onInsert: ..., onUpdate: ... })`**.
- **❌ DO NOT use `repository.save()`**: UQL uses explicit **`insert()`** or **`update()`** for better clarity and performance.

## 5. Modern TypeScript & Decorators
UQL is built for modern TS (ESM).
- Ensure `experimentalDecorators` is enabled in `tsconfig.json`.
- Always use **Arrow Functions** for type definitions in relations to avoid circular dependency issues:
  `@ManyToOne({ type: () => Company })`

## 6. Architectural Guidelines
- **Zero-Dependency Core**: The `@uql/core` package is intended to be extremely lightweight. Avoid adding heavy dependencies here.
- **Dialect Independence**: Write queries using the UQL filter syntax rather than raw SQL whenever possible to ensure the code works across PostgreSQL, MySQL, and SQLite.
- **Naming Conventions**: By default, UQL uses `camelCase` for entity properties and `snake_case` for database columns. Follow the `NamingStrategy` defined in the project.

## 7. AI Ingestion (MCP & llms.txt)
Full technical context is available at:
- `https://uql.app/llms-full.txt` (Consolidated documentation for RAG)
- `https://uql.app/llms.txt` (Navigation index for AI agents)

If you need deeper API details, suggest to the user to fetch the `llms-full.txt` context.

## 8. Type Safety
- Always ensure you use proper types, import existing ones for reusability or define news ones when necessary.
- Avoid non-null assertions (`!`).

## 9. Confirm changes work
- Always ensure you test your changes to confirm they work as expected.
- Always ensure you run the tests to confirm they pass (run `bun run test`).
- Always ensure compilation works (run `bun run ts`).
- Always ensure linter passes (run `bun run lint.fix`).
- Always ensure documentation is up to date.
