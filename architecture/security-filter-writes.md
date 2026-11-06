# Security filters on writes

A `security: true` filter scopes reads, and is also the `WITH CHECK` on what a write leaves behind. Without that, a tenant-42 context could `saveOne` tenant 99's invoice by id, insert into tenant 99, or move its own row there; over the API those are `saveOne`, `insertOne` and `updateOneById` calls.

## The rule

The filter's condition, resolved from the context as a read resolves it, names the **guarded fields** and their values.

- **Insert**: a guarded field the row leaves out is filled; one it carries must hold the value.
- **Update**: a payload naming a guarded field must hold the value. The `$where` is already scoped.
- **Upsert, and a save naming its key**: the rows the conflict names are read under the filter; those found update, the rest insert. Another tenant's row is not found, so its insert fails on the key with a `409`.
- **`{}`** writes unchecked, as Hibernate's root tenant does.
- **A condition that is not field equalities** refuses the write. Every filter in use is one equality; `$in` is the likely next shape, as membership with no fill.
- **A refusal is `UqlSecurityError`**, a 403 over REST.
- **`ops`** names the statements a filter holds, every one by default. A read is scoped by the filters holding `read`. An update or a delete reads the rows it changes, so it is scoped by its own and the read ones, as Postgres RLS applies `SELECT` policies to an `UPDATE`; its settling reads take the same scope. An insert and an update payload are held to the filters holding that statement alone. A guarded upsert reads its rows with the update's scope, so a row the caller may read but not update is not found, and its insert fails on the key.

Hibernate `@TenantId`, acts_as_tenant, django-multitenant and Postgres RLS land on the same rules. EF Core, MikroORM, Prisma and Drizzle guard reads only.

## Where it lives

- **One resolver**, `securityConditions(meta, accesses)`: reads AND it in, writes guard with it, so the two cannot disagree. The access rides on the statement's options (`StatementOptions.access`), set once where a write starts.
- **One call site per write**, `guardWrite` in the querier's `insertRows` and `prepareUpdate`, after the `before` hooks and under every caller: cascades, relation saves, the API, NestJS.
- **The upsert reuses `idsByConflict`** and runs in a transaction, on MongoDB the one the caller opens, so no dialect renders anything new. It costs two or three statements, only where the condition is not `{}`.

**Rejected: a guarded upsert per dialect** (`DO UPDATE ... WHERE`, `MERGE ... WHEN MATCHED AND`, MySQL's `IF()`). Atomic, but four renderings, and a skipped row is silent everywhere but Postgres. The read holds the rows it finds until the write (SQLite fails a racing writer instead, and so does MongoDB inside a transaction the caller opens), so the read-then-write loses only two concurrent upserts of one new key, where the second fails on the key: closed and retryable. The `$where` upsert now renders these for a condition the caller names; a guard still reads first, so a row it skips is not silent.

## Open

- **A foreign key into another tenant** is accepted, as RLS accepts it: it reads back as `null` through the target's filter. Refusing it costs a read per foreign key written.
