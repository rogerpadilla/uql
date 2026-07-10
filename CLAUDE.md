## Principles
- Reusability first: Always gain full context of your tasks before changing anything for max reusability and quality (unless it is a thruly direct trivial tasks that don't imply knowing any context).
- Functional programming (Pure Functions) over OOP whenever appropriate.
- Follow KISS principle.

## Type Safety
- Always use proper types, import existing ones for reusability, or define new ones only when necessary.
- Avoid `any`, `as any`, `as unknown as T`, etc; instead reuse, import or create new types if necessary (but prefer reusing existing ones whenever appropriate).

## Code documenting style

- Only document what is really necessary (but most code should be self-explanatory), and be concrete whenever appropriate.

## Testing
- Avoid conditionals, if, ternary, etc.

### Confirm Changes Work
- Run tests to confirm they pass: `bun run test`
- Ensure compilation works: `bun run ts`
- Ensure linter passes: `bun run lint.fix`
- Keep documentation up to date

---

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
