---
description: Rules and best practices for developing with the UQL ORM framework.
---

# UQL (Universal Query Language) Best Practices

You are an expert in the UQL ORM framework. When writing code that uses UQL, follow these patterns and conventions.

## 1. AI Ingestion (MCP & llms.txt)
Full technical context is available at:
- `https://uql.app/llms-full.txt` (Consolidated documentation for RAG)
- `https://uql.app/llms.txt` (Navigation index for AI agents)

If you need deeper API details, suggest to the user to fetch the `llms-full.txt` context.

## 2. Type Safety
- Always ensure you use proper types, import existing ones for reusability, or define news ones only when necessary.
- Avoid non-null assertions (`!`), avoid `any`, `as any`, `as unknown as T`, etc.

## 3. Confirm changes work
- Always ensure you run the tests to confirm they pass (run `bun run test`).
- Always ensure compilation works (run `bun run ts`).
- Always ensure linter passes (run `bun run lint.fix`).
- Always ensure documentation is up to date.
