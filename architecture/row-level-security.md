# Row-level security

**Design, not built.** One policy, stored as data, enforced by the database on the Postgres family and by the querier elsewhere, a suite proving the two answer alike. Measured need drives it, from two Postgres apps that scope by hand and use no `security` filter: Variability, a workspace's rows across 89 files, which is tenancy (`f.tenant()`); and Variabilidad, a marketplace whose rows belong to a seller, a buyer or an account, often two at once (a conversation, a review), and some to anyone (a published listing), across about 63 hand-written `where`s, which is the policy model (several `allow`s, a `when`). So Postgres comes first, and what no user has asked for yet waits ([Not yet](#not-yet)). It replaces `security: true` filters, whose write rules ([security-filter-writes.md](security-filter-writes.md)) become the app half of it.

## Where the others stand

Surveyed 2026-11-10, every clone pulled first.

|                    | Declared and migrated                                                                                                     | Bound per request                                                                                  | App reads            | App write checks                                                                           | Native on             |
| :----------------- | :------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------- | :------------------- | :----------------------------------------------------------------------------------------- | :-------------------- |
| MikroORM           | `policies`, `rowLevelSecurity: 'force'`, diffed by name, introspected                                                     | `set_config(..., true)` and `SET LOCAL ROLE` after each `BEGIN`, an implicit transaction otherwise | filters              | none                                                                                       | Postgres, PGlite      |
| Prisma 8 rc        | `@@rls`, name prefix plus content hash, introspected, roles verified never created, the last policy dropped leaves RLS on | Supabase extension only, at session level, reset on release                                        | none                 | none                                                                                       | Postgres              |
| Drizzle (1.0 beta) | `pgPolicy`, `pgRole`, `withRLS`, raw `sql` predicates, diffed and introspected                                            | none                                                                                               | none                 | none                                                                                       | Postgres, CockroachDB |
| ZenStack v3        | none                                                                                                                      | `$setAuth`, app only                                                                               | `@@allow` / `@@deny` | before create, before and after update with `before()`, before delete; field-level masking | none                  |
| PostgREST          | hand-written                                                                                                              | one `set_config` batch per request transaction, role switch, `pre-request` hook                    | none                 | the database's                                                                             | Postgres              |

No one compiles a typed relational predicate into a policy (MikroORM's bridge takes six comparison operators), no one declares SQL Server security policies or Oracle VPD, and no one proves app and native enforcement agree.

## The policy

`.policies()` is a definition section of its own, beside `.filters()`, which keeps only convenience scopes such as soft delete.

```ts
.policies((invoice, policy, ctx) => [
  policy.must({ tenantId: ctx.tenantId }),
  policy.allow(['read'], { project: { members: { userId: ctx.userId } } }),
  policy.allow(['update'], { ownerId: ctx.userId }, { check: { status: { $ne: 'void' } } }),
  policy.allow({ when: { role: 'admin' } }),
])
```

- **The section's callback takes the entity's refs, the policy builder and the context's refs**, as `.indexes()` takes its refs and `index`. Nothing is imported.
- **`effect`** is `allow` or `must`. Allows OR together, musts AND together, and an entity declaring policies with no allow for an op denies it. These are Postgres's permissive and restrictive policies exactly: `must` renders as `AS RESTRICTIVE`.
- **`ops`**: `read`, `insert`, `update`, `delete`, every one by default.
- **`where`** names the rows the policy reaches (`USING`). **`check`** is what a written row must hold (`WITH CHECK`), `where` by default. An update or a delete is also held to the read policies, as Postgres holds them.
- **`when`** is a `QueryWhere` over the context alone, folded before rendering, so an admin's statement carries no predicate.
- **A predicate is a `QueryWhere`**: plain JSON, members read off refs, `ctx.tenantId` the ref whose data form is `{ $context: 'tenantId' }`, typed by `UqlContext`.
- **`$allowed`** reads another entity's policy through a relation: `{ post: { $allowed: 'read' } }` reaches a comment when its post is readable. A lookup reading a table whose own policies read back here, members seeing fellow members of a project, renders natively as a uql-owned `SECURITY DEFINER` function (`_uql_`-named) reading past RLS for that lookup alone, where a plain subquery recurses without end; in the app it runs unpoliced. Any other cycle is refused at registration.
- Each policy has a data form and travels in the schema document.

**`must`, not `restrict`**, the database's word, which reads as a deny (`restrict({ status: 'archived' })` meant to hide archived rows), and not `require`, which reads as CommonJS's. **Rejected: a `deny` effect.** `NOT (predicate)` is NULL where the predicate is, and a NULL policy passes nothing on one engine and is easy to get backwards on the next. `must` says the same with no negation.

## Beside filters, hooks, checks and wire

Policies take over the security half of filters, and what both share becomes one mechanism.

- **One context reference.** A filter takes the context as a policy does, by refs: `.filters((post, filter, ctx) => ...)` with `ctx.userId`, whose data form is `{ $context: 'userId' }`. The function form `where: (ctx) => ...` goes, leaving one spelling, the one the schema document carries.
- **One resolver.** `applyFilters`, `securityConditions` and `SCOPED_BY` become one function answering a statement's predicate: the allows ORed, ANDed with the musts and the active filters. Reads, write checks and the native renderer all call it, and `can()` will.
- **A missing context key is a rule of the section, not an option.** A filter whose key is missing is skipped; a policy's matches nothing. `onMissing` goes.
- **Trust is a pool, not a value.** A pool with `policies: false` runs as the database's bypass role and skips the app path, so trusted work is one thing natively and in the app. A security filter's `{}` meaning "no restriction" goes.
- **One vocabulary.** A policy's `ops` are `EntityAccess`, as `wire` takes them; a field policy's will be `FieldAccess`, and `$old` will render through the trigger code.
- **Gone from filters:** `security`, `ops`, `onMissing` and the function form. A filter is a convenience scope again: switched off by name, yielding to a `$where` on its own field, never native, never guarding a write.

Kept apart, on purpose:

- **Filters and policies stay two sections.** A switchable `must` would put a bypass flag inside security code for a reviewer to hunt for. Hibernate keeps `@Filter` apart from `@TenantId`; MikroORM merged the two and needed `rls: true` to tell them apart again.
- **Hooks stay code.** They do not travel, and no database can enforce one. The write check runs after the `before` hooks, so no hook writes around a policy.
- **Checks stay checks.** A `CHECK` holds for every role, the owner's included; a `must` does not hold for the bypass role. Registration suggests `.checks()` for a `must` with only a `check` and no context.
- **`wire` stays.** It is what the API exposes to an untrusted client; a policy holds every caller, server code included. A field policy would extend its `FieldAccess` per row, not replace it.

## Tenancy

`f.tenant()` marks the tenant column, and from it:

- a `must` policy on it, from the context key it names;
- the insert fills it, as `guardWrite` fills a guarded field now;
- every foreign key between two tenant-scoped entities is composite, `(tenant_id, post_id)` referencing `post (tenant_id, id)`, so the database refuses a key into another tenant. This closes the open item in [security-filter-writes.md](security-filter-writes.md#open);
- every unique key and suggested index leads with it.

## Enforcement

A `dialect.features.rowSecurity` key states how an engine enforces a policy and binds the context. On a native engine the database is the authority: the querier binds the context and maps errors, and adds no predicate. Elsewhere the querier enforces the same predicate. `rls: 'native'` on a pool refuses to start on an engine that is not native.

| Engine                                      | `where`                    | `check`                                                                                                                                        | `$old`                              | Context                        |
| :------------------------------------------ | :------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------- | :----------------------------- |
| Postgres, PGlite, Neon, Bun SQL             | `CREATE POLICY ... USING`  | `WITH CHECK`                                                                                                                                   | a `BEFORE UPDATE` trigger           | `set_config(key, value, true)` |
| CockroachDB 25.2+                           | the same                   | the same                                                                                                                                       | a trigger                           | the same                       |
| SQL Server                                  | `FILTER PREDICATE`         | `BLOCK PREDICATE ... AFTER INSERT, AFTER UPDATE`                                                                                               | `BLOCK PREDICATE ... BEFORE UPDATE` | `sp_set_session_context`       |
| Oracle 23ai+                                | VPD, `DBMS_RLS.ADD_POLICY` | `update_check => TRUE`                                                                                                                         | a trigger                           | `DBMS_SESSION.SET_CONTEXT`     |
| MySQL, MariaDB, SQLite, D1, libSQL, MongoDB | the querier's `$where`     | a read of the candidate rows: `EXISTS (SELECT ... FROM (VALUES ...) WHERE ...)` before an insert, a re-read in the transaction after an update | a read before the update            | none                           |

- **CockroachDB's RLS skips foreign-key cascades and the `ON CONFLICT` path**, so those two take the app check too.
- **On an app-only engine, raw `run()` under a context with policies is refused** unless the call says it is trusted. A native engine needs no such rule: the database holds raw SQL to the policies.
- **A policy's `where` is rendered by the dialect that renders a statement's**, relation subqueries included. `$allowed` renders natively as a bare `EXISTS` over the related table, which the database already scopes by that table's policies; in the app it inlines them.
- **A context read renders as `(SELECT nullif(current_setting('uql.tenantId', true), '')::<type>)`**: an unset key is NULL, which matches nothing, and the subselect is evaluated once per statement, not per row.

**Rejected: native and app enforcement together.** It doubles every predicate a statement plans for nothing the equivalence suite does not already prove. **Rejected: views over session variables for MySQL and MariaDB.** Neither has native policies (MariaDB's request is MDEV-27301), and a session variable outlives the request on a pooled connection.

## Binding the context

- **Per transaction, never per session.** The keys the policies read lead each statement's list in `runStatements`, as a vector search's `SET LOCAL` leads its read: one `SELECT set_config(...), set_config(...)`. A list holding them runs as one transaction; on Postgres-wire drivers that pipeline, the three messages before one `Sync` are one implicit transaction, with no extra round trip. Over Neon's HTTP it is `sql.transaction([...])`. This holds under pgBouncer and Supavisor transaction pooling, where Prisma's session binding does not.
- **Only the keys a policy reads are sent**, collected from metadata at registration.
- **SQL Server** sets `sp_set_session_context` on the connection a querier pins, cleared when the pool resets it.
- **The context comes from verified claims.** `contextOf` validates them with a Standard Schema, and that typed object is what is bound. On Neon a JWT may be bound instead for `pg_session_jwt` to verify in the database.
- **Three roles.** The runtime pool's role owns no table and lacks `BYPASSRLS`, every policied table is `FORCE`d, a `policies: false` pool runs trusted work as the bypass role, and migrations run as the owner. The runtime pool checks its role on start and refuses one that bypasses or owns. **Rejected: a bypass variable**, since any SQL on the connection can set one.
- **A cached result is keyed by the context keys its policies read.**

## Pitfalls it answers

- **A context changed inside an open transaction** is bound again before the transaction's next statement, so a nested `withContext` never runs under the outer one's keys.
- **A materialized view over a policied table is refused** unless it declares the same policies: Postgres refreshes one as its owner, past RLS. The emulated table form takes them as any table does.
- **A vector search on a policied table** turns on pgvector's iterative scan in the tuning it already sends, since HNSW filters after the index and an RLS filter would leave fewer than the `$limit` rows.
- **Postgres's security barrier** evaluates a caller's leaky predicate (`LIKE`, a regex) after the policy's quals, which can cost it its index. Benchmarked per engine before phase 2 is done; an entity where it costs falls back to the app path.
- **Side channels.** A unique or foreign key violation tells a caller another tenant's row exists. Composite tenant foreign keys close the second, and a unique key leading with the tenant column the first.

## Migrations

- A policy is installed as `_uql_<table>__<label>_<hash>`, the hash of its rendered SQL, as a check and a trigger are: the engine's reprint never matches what uql wrote, so the name carries the edit.
- Introspected from `pg_policies`, `sys.security_policies` with `sys.security_predicates`, and `DBA_POLICIES`.
- A table with policies is `ENABLE`d and `FORCE`d. Removing its last policy keeps it enabled, so it fails closed; removing `.policies()` disables it, a drop safe mode holds.
- Safe mode holds a policy drop. A policy not named `_uql_` is warned about, never dropped.
- Roles are verified to exist, never created.
- A view uql creates is `security_invoker`, so it is held to its tables' policies.

## Beyond the database

- **The wire** runs every call and live query under its caller's context: nothing to configure per entity beyond `.policies()`.
- **Errors.** Postgres's `42501`, SQL Server's block-predicate error and the app's refusal are all `UqlSecurityError`, a 403. A row the caller cannot read is a 404 on every path, so nothing tells it the row exists.

## Proof

- **The equivalence suite.** For each fixture policy, a matrix of contexts, ops and rows runs on Postgres native, on Postgres with the app enforcing, and on every app-only engine, and every answer matches; on a native engine it runs raw `run()` too.
- **`uql policy explain <Entity> --as <context>`** prints each op's resolved predicate and the SQL each engine is given.
- **Registration warns** on a policy column no index leads with, a predicate that is always true, a cycle through `$allowed`, and an entity with no policies under `rls: 'required'`.
- **Measured before done**: `ts.perf` for the section's types and a benchmark of a policied read and write per engine.

## Build order

1. The section, its data form, the one resolver and the app path, replacing `security: true` filters and their tests; filters move to context refs and lose `security`, `ops`, `onMissing` and the function form.
2. Postgres family native and tenancy: rendering, the membership function, binding in `runStatements`, migrations, composite foreign keys, the pitfalls above, the equivalence suite. Done when Variability's hand-written `workspaceId` scoping and Variabilidad's seller, buyer and account scoping are deleted, as policies, and both apps' tests pass. Variability upgrades from 0.112 first.
3. CockroachDB, nearly free after 2.

## Not yet

No user has asked for these. Each is designed so it adds without reshaping 1 to 3, and waits for one who does.

- **SQL Server and Oracle native.** Their rows above say how each renders. Open for SQL Server: whether the `mssql` pool's reset clears `SESSION_CONTEXT` on every driver path, or the querier clears it on release.
- **`$old`**: a `check` reading the row as it was before the update, a transition rule, rendered as the enforcement table's `$old` column says.
- **Field policies**: a field the caller may not read masked to `null` (a `CASE WHEN`, as ZenStack does), typed `T | null` only if `ts.perf` allows.
- **`can(ctx, op, Entity, row)`**: a policy evaluated on a row in memory, on the server and in the browser, needing an evaluator that matches SQL's NULLs; a predicate reading a relation answers `undefined`.

## Open

- Whether every Postgres-wire driver uql ships can pipeline the binding before one `Sync`, or which pay a `BEGIN` round trip.
- How `$allowed` reads a to-many relation: any related row, as a filter on a to-many relation reads, is the likely answer.
