# Security filters on writes

**Built in 0.84.0.** Until then a `security: true` filter scoped every read, update and delete, but nothing checked the rows a write left behind. Reproduced on SQLite, in a tenant-42 context, invoice 7 belonging to tenant 99:

| Call as tenant 42                               | Before 0.84.0                                     |
| :---------------------------------------------- | :------------------------------------------------ |
| `findOne` / `updateMany` / `deleteMany` on id 7 | blocked                                           |
| `saveOne({ id: 7, companyId: 42, total: 1 })`   | takes invoice 7 over: tenant 99 no longer sees it |
| `insertOne({ companyId: 99, ... })`             | writes a row into tenant 99                       |
| `updateMany({ id: 9 }, { companyId: 99 })`      | moves its own row into tenant 99                  |

The recipe the docs gave, `updatable: false` plus an `onInsert` fill, stopped only the last, and silently: `saveOne({ id: 7, total: 1 })` still overwrote tenant 99's total, and an explicit `companyId: 99` still won over `onInsert`. Over `uql-orm/http` these are `PUT`, `POST` and `PATCH`, open to any authenticated client.

The cause was structural: `applyFilters` is reached only through `scopedWhere`, which renders a `$where`. An insert has none, an upsert's `DO UPDATE` has none, and an update's `SET` is not one.

## What others do

|                                    | Insert                                                      | Update                                                                    | Upsert / save by id                                                  |
| :--------------------------------- | :---------------------------------------------------------- | :------------------------------------------------------------------------ | :------------------------------------------------------------------- |
| Hibernate `@TenantId`              | fills; a differing value throws, except for the root tenant | column not updatable                                                      | loads under the filter; another tenant's id inserts and hits the key |
| acts_as_tenant                     | fills; a differing tenant fails validation                  | `TenantIsImmutable`                                                       | as update                                                            |
| django-multitenant                 | fills                                                       | "Tenant column of a row cannot be updated"; tenant ANDed into the `WHERE` | update matches nothing, the insert hits the key                      |
| Postgres RLS                       | `WITH CHECK` on the new row                                 | `USING` on the old, `WITH CHECK` on the new                               | `ON CONFLICT DO UPDATE` on a row outside the policy errors           |
| remult (REST)                      | `allowApiInsert(newRow)`                                    | loads under `apiPrefilter`, checks `allowApiUpdate(row)` after the change | none on the API                                                      |
| EF Core, MikroORM, Prisma, Drizzle | reads only; Drizzle declares RLS policies instead           |                                                                           |                                                                      |

Every library that guards writes lands on the same rules: a new row gets the tenant, a differing tenant is refused, the tenant never changes, and a write keyed on another tenant's row fails.

## Measured usage

Every security filter in the test suites and the docs is one equality, `{ tenantId: ctx.x }`, plus the documented `{}` for a trusted system context. Variability declares none. Nothing uses an operator, a disjunction or a relation in one.

## The rule

The security filter is its own `WITH CHECK`, with no new option. Its condition, resolved from the context as a read resolves it, names the **guarded fields** and their values.

- **Insert**: a guarded field the row leaves out is filled; one it carries must hold the value.
- **Update**: a payload naming a guarded field must hold the value. The `$where` is already scoped.
- **Upsert, and a save naming its key**: the rows the conflict names are read under the filter; those found update, the rest insert. Another tenant's row is not found, so its insert fails on the key, the `409` a unique violation already answers.
- **`{}`** writes unchecked, as Hibernate's root tenant does.
- **A condition that is not field equalities** refuses the write rather than guessing. `$in` is the likely next shape, as membership with no fill, once something uses it.
- **A refusal is `UqlSecurityError`**, as a missing context already is.

## What it reuses, and what it removes

- **One resolver.** `applyFilters` interleaves security and convenience filters in one loop. It splits into `securityConditions(meta)`, what the ambient context resolves every security filter to, throwing where one cannot resolve, and the convenience merge. Reads AND the conditions in; writes guard with them. Neither can resolve a filter differently from the other.
- **One call site per write, in the querier.** `guardWrite(meta, rows, 'insert' | 'update')` sits beside `fillOnFields` in `insertRows`, which an insert and a guarded upsert's insert half share, and in `updateRows`, inside `hooked`'s write callback: after the `before` hooks, so their assignments are checked, and under every caller: direct calls, cascades, relation saves, `/http`, NestJS. `/http` needs no code of its own.
- **The upsert reuses `idsByConflict`**, which already reads the rows a conflict names, through the filters: those it finds update by the same columns, the rest insert, in one transaction. No dialect renders anything new, so MongoDB behaves as SQL does. It costs two or three statements where there was one, only on an entity whose condition is not `{}`. The querier keeps the upsert's own path otherwise: the dialect has to fill `onInsert` itself there, to keep those columns out of `DO UPDATE`.
- **The error joins the others.** `UqlSecurityError` moves beside `UqlUsageError` and `UqlOptimisticLockError` in `util/uqlError.ts`, re-exported where it was, and all three extend one `UqlError` stating `kind` and `status`: `queryErrorKind` reads any of them with one `instanceof`, and `/http` answers 403 instead of 500.
- **The docs lose a recipe.** The `onInsert` tenant fill and its `updatable: false` go: the filter does both. The guarantees are stated once, in `multi-tenancy.mdx`; `filters.md`, `http.md`, `supabase.md`, `nestjs.md`, `postgres.md` and `faq.md` link there instead of restating them, which is how `supabase.md` came to promise "every read, write ... is scoped".

**Considered: a guarded upsert in each dialect.** `DO UPDATE ... WHERE` on Postgres and SQLite, `WHEN MATCHED AND` on SQL Server's `MERGE`, `IF()` per assignment on MySQL, the condition in MongoDB's upsert filter. Atomic under concurrency, but four renderings, and a skipped row is silent everywhere but Postgres's `RETURNING`: MySQL reports it as an unchanged row. The read-then-write loses one case: two concurrent upserts of the same new key, where the second fails on the key instead of updating. That fails closed and is retryable; revisit when a guarded upsert shows up in a profile.

## Not in this change

- **A foreign key into another tenant.** acts_as_tenant refuses a `customerId` naming another tenant's customer; RLS does not, since foreign keys bypass policies. It is integrity, not leakage: the reference reads back as `null` through the target's filter. It would cost a read per foreign key written.
- **`/http` answers a 500 with the error's message**, a driver's included.
- **Two names mean two things.** `getContext` is both the `/http` option resolving a request and the function reading the ambient context; `HookContext` is both the entity hook's argument and `/http`'s, whose `context` is the request. Public API, so a rename asks first.
