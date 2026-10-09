# Security filters on writes

A `security: true` filter scopes reads, and is also the `WITH CHECK` on what a write leaves behind. Without that, a tenant-42 context could `saveOne` tenant 99's invoice by id, insert into tenant 99, or move its own row there; over `uql-orm/http` those are `PUT`, `POST` and `PATCH`.

## The rule

The filter's condition, resolved from the context as a read resolves it, names the **guarded fields** and their values.

- **Insert**: a guarded field the row leaves out is filled; one it carries must hold the value.
- **Update**: a payload naming a guarded field must hold the value. The `$where` is already scoped.
- **Upsert, and a save naming its key**: the rows the conflict names are read under the filter; those found update, the rest insert. Another tenant's row is not found, so its insert fails on the key with a `409`.
- **`{}`** writes unchecked, as Hibernate's root tenant does.
- **A condition that is not field equalities** refuses the write. Every filter in use is one equality; `$in` is the likely next shape, as membership with no fill.
- **A refusal is `UqlSecurityError`**, a 403 over `/http`.

Hibernate `@TenantId`, acts_as_tenant, django-multitenant and Postgres RLS land on the same rules. EF Core, MikroORM, Prisma and Drizzle guard reads only.

## Where it lives

- **One resolver**, `securityConditions(meta)`: reads AND it in, writes guard with it, so the two cannot disagree.
- **One call site per write**, `guardWrite` in the querier's `insertRows` and `updateRows`, after the `before` hooks and under every caller: cascades, relation saves, `/http`, NestJS.
- **The upsert reuses `idsByConflict`** and runs in one transaction, so no dialect renders anything new and MongoDB behaves as SQL. It costs two or three statements, only where the condition is not `{}`.

**Rejected: a guarded upsert per dialect** (`DO UPDATE ... WHERE`, `MERGE ... WHEN MATCHED AND`, MySQL's `IF()`). Atomic, but four renderings, and a skipped row is silent everywhere but Postgres. The read-then-write loses only two concurrent upserts of one new key, where the second fails on the key: closed and retryable.

## Open

- **A foreign key into another tenant** is accepted, as RLS accepts it: it reads back as `null` through the target's filter. Refusing it costs a read per foreign key written.
- **`/http` answers a 500 with the error's message**, a driver's included.
- **`getContext` and `HookContext` each name two things** (the `/http` option and the ambient reader; the hook's argument and `/http`'s). Public API, so a rename asks first.
