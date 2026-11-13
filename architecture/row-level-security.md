# Row-level security

**Built: the policy model, a tenant column, the querier's enforcement on every engine, and native enforcement on Postgres and CockroachDB.** Not yet: SQL Server's native predicates, composite tenant keys, transitions, field policies and `can()` ([Next](#next)).

One policy, stored as data, held by the querier on every engine and, where a pool asks, by the database itself. Measured need drives it, from two Postgres apps that scope by hand: Artudito, a workspace's rows across 89 files, which is tenancy; and Variabilidad, a marketplace whose rows belong to a seller, a buyer or an account, often two at once, and some to anyone, which is the policy model (several `allow`s, a `when`).

## Where the others stand

Surveyed 2026-11-10, every clone pulled first.

|                    | Declared and migrated                                                                                                     | Bound per request                                                                                  | App reads            | App write checks                                                                           | Native on             |
| :----------------- | :------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------- | :------------------- | :----------------------------------------------------------------------------------------- | :-------------------- |
| MikroORM           | `policies`, `rowLevelSecurity: 'force'`, diffed by name, introspected                                                     | `set_config(..., true)` and `SET LOCAL ROLE` after each `BEGIN`, an implicit transaction otherwise | filters              | none                                                                                       | Postgres, PGlite      |
| Prisma 8 rc        | `@@rls`, name prefix plus content hash, introspected, roles verified never created, the last policy dropped leaves RLS on | Supabase extension only, at session level, reset on release                                        | none                 | none                                                                                       | Postgres              |
| Drizzle (1.0 beta) | `pgPolicy`, `pgRole`, `withRLS`, raw `sql` predicates, diffed and introspected                                            | none                                                                                               | none                 | none                                                                                       | Postgres, CockroachDB |
| ZenStack v3        | none                                                                                                                      | `$setAuth`, app only                                                                               | `@@allow` / `@@deny` | before create, before and after update with `before()`, before delete; field-level masking | none                  |
| PostgREST          | hand-written                                                                                                              | one `set_config` batch per request transaction, role switch, `pre-request` hook                    | none                 | the database's                                                                             | Postgres              |

No other compiles a typed relational predicate into a policy (MikroORM's bridge takes six comparison operators), holds writes to a check on every engine, or holds raw SQL to the same policy it enforces itself.

## The policy

```ts
@Entity({
  policies: [
    { must: { tenantId: $context.tenantId } },
    { allow: { project: { members: { userId: $context.userId } } }, ops: ['read'] },
    { allow: { ownerId: $context.userId }, check: { status: { $ne: 'void' } } },
    { allow: {}, when: { role: 'admin' } },
  ],
})
```

- **Data throughout.** A policy is `{ allow: where }` or `{ must: where }` beside its options; `$context.tenantId` is `{ $context: 'tenantId' }`, typed by `UqlContext` through `SQL_VALUE_TYPE`, so a key holding a string never meets a number column. `$context`, `when` and `tenant()` take only the keys `UqlContext` declares (`ContextKey`, its index signature left out), any string where it declares none. It is the schema document's form as it is.
- **`allow` and `must`.** Allows OR together, musts AND together: Postgres's permissive and restrictive policies. An entity declaring an allow reaches no row in a statement none of them holds; one declaring none is given an allow reaching every row (`everyRow`), so a must alone narrows, as tenancy does, and still fails closed on a missing key. `must`, not `restrict`, which reads as a deny, and not `require`, which reads as CommonJS's.
- **A tenant column.** `.tenant($context.orgId)` on one field, `$context.tenantId` where unset, a key that holds the column's type, registers the must `{ field: $context[contextKey] }`, named `tenant`, which an insert's pinned fields fill. Derived from the merged fields at registration, as `softDelete` is.
- **`ops`**: `read`, `insert`, `update`, `delete`, every one where unset. An update and a delete are held to the `read` policies too, as Postgres holds them.
- **`where`** names the rows a policy reaches (`USING`); **`check`** is what a written row must hold (`WITH CHECK`), the `where` where unset.
- **`when`** compares context keys to a value, or to any of a list, folded before a statement is written, so an admin's statement carries no predicate. Natively it is `IN` over the setting as text.
- **`explainPolicies(entity, access, context?)`** answers the `where` the querier ANDs in and the `check` a written row must hold, for "why does this read reach no row".
- **A relation is read as any `$where` reads it**, a to-many as "any related row".
- **A section, not a callback.** A section callback typed by the row made two entities whose policies read each other circular in TypeScript; an array of literals checks as filters do. Of `filters` and `policies` after `relations`, the one chained last may read through them.

**Rejected: a `deny` effect.** `NOT (predicate)` is NULL where the predicate is, and a NULL policy is easy to get backwards. `must` says the same with no negation.

## A missing key

The querier reads a policy as the database does. A comparison against a key the context lacks, or holds null, is SQL's unknown: never true, whatever negates it. `bindContext` carries the polarity down the predicate: under `$and` and `$or` the comparison is false, under `$not` and `$nor` true, so the negation never holds, and a relation's subquery restarts it. So no context reaches no row, on every engine, as native policies answer; the querier never throws for it.

## Filters, hooks, checks and wire

- **Filters are convenience scopes again**: switched off by name, yielding to a `$where` on their field, never guarding a write. `security`, `ops` and `onMissing` are gone, and a filter naming `security` is refused at registration. A filter's `where` reads the context as a policy's does, `$context.userId`, and is skipped where the context lacks a key it reads (a policy reaches no row instead); its function form stays as sugar.
- **One table of modes.** `enforcementOf(mode)` answers what the querier does under `'app'`, `'native'` and `false`: scope statements, guard pinned fields, read checks back, or leave the rest to the database it binds the context for. Nothing else compares modes.
- **One resolver.** `policyScope` and `policyCheck` answer a statement's predicate; `applyFilters` ANDs the scope into every query scope (`scopedWhere`), relation subqueries, populates and counts included, and `guardWrite` holds writes to the check. `constrainsRelations` reads the scoped `$where`, so a policy reading a relation sends MongoDB through its pipeline and a write without correlated subqueries through its settling read.
- **Trust is a pool.** `{ policies: false }` holds no statement to a policy: a job across tenants, pointed at a role that bypasses row-level security. Nothing per call turns a policy off: the querier's own read past them is marked by a symbol no options can carry.
- **Hooks stay code**, and the write check runs after the `before` hooks, so no hook writes around a policy. **Checks stay checks**: a `CHECK` holds for every role. **`wire` stays** what an API exposes; a policy holds every caller.

## The querier's enforcement

Every engine, unless the pool says otherwise.

- **Reads**: the scope ANDed in. An update or a delete takes its own and the read one.
- **Writes**: `guardWrite` reads the check's top-level equalities. An insert gets each field it pins and leaves out; a write setting another is refused with `UqlSecurityError`, a 403. What the rows cannot settle (an operator, an `$or`, a relation), the querier reads back inside the write's transaction, counting the written rows that hold the check past every filter and policy, and refuses with the write undone where any does not. An update needs no read where the payload names each pinned field or the update's scope pins it to the same value.
- **A write it cannot undo is refused before it writes**: D1 has no transaction, and MongoDB undoes a write's steps only inside a `transaction()` the caller opens.
- **An upsert reads first** where an entity has policies, as a versioned one does, so another tenant's row is not found and its insert fails on the key with a `409`.

## Native enforcement

`{ policies: 'native' }`, where `dialect.features.rowSecurity` is not `false`: Postgres, PGlite, Neon and Bun SQL, and CockroachDB, whose `subqueries: false` says it takes no subquery in a policy. The database is the authority; the querier binds the context, fills pinned fields and refuses what it can tell early, and reads nothing back.

- **DDL.** One `CREATE POLICY ... AS PERMISSIVE|RESTRICTIVE` per policy, `FOR ALL` where it holds every statement, else one per statement, each named `_uql_<table>__<label>_<hash>` over its SQL. A context read is `(SELECT nullif(current_setting('uql.<key>', true), '')::<column type>)`, the subselect read once per statement; bare on CockroachDB. `when` compares the setting as text, but `current_user` at the pool's role key. A relation renders as the `EXISTS` the querier would write, which the database scopes by that table's own policies. CockroachDB refuses a policy reading a relation by name.
- **Migrations.** Read back from `pg_policies` as the statement recreating each, diffed by name, dropped first and created last in an alter, and a kept one is taken off and put back around a column the alter moves under it, as a trigger is; drift reports one missing or stale. Row-level security is the table's state, `forced`, `enabled` or `off`, read back from `pg_class`. A table with uql's policies needs it forced, so its owner is held too. Once the last is gone it is unforced, never disabled: a table someone else enabled, as Supabase does, stays held to their policies, and one uql enabled stays deny-all to all but its owner until disabled by hand. A rollback puts back the state it found, and drift calls it unforced under policies critical. A table holding none of uql's policies keeps its state, a second writer's.
- **Binding.** Per transaction, never per session: `set_config('uql.<key>', $n, true)` for each scalar or date key of the context, ahead of the first statement of a transaction or of a new context in it, every key the transaction bound and this one lacks set empty. A statement outside a transaction under a context runs in one of its own. A rollback to a savepoint binds again, since it may bring back any key bound before it. This holds under pgBouncer and Supavisor transaction pooling. A stream under a context runs in an open transaction.
- **Database roles.** `{ policies: 'native', role: $context.role }` names the context key holding the role a transaction runs as: the binding also sets `role` (`none` where a later context names none), and a `when` on that key compares `current_user` exactly, so Supabase's `anon` and `authenticated` are the context's. Not `TO`: Postgres holds a role to each policy `TO` a role it inherits, and a login role inherits the roles it switches to, so it would pass them under a context naming none. In app mode the same `when` compares the context, so one declaration reads alike in both. Unset, a transaction runs as the role the pool connects as.
- **The role.** A statement under a context is refused where its role, the one it names or the connected one, is a superuser or has `BYPASSRLS`, which would show one tenant another's rows; asked once per role and pool. A statement under none, a migration's, runs as the owner it connects as.
- **Errors.** SQLSTATE `42501` is `security`.
- **Postgres reads an inserted row back** (`RETURNING`), so the inserting context must be able to read it.
- **An upsert is its one statement**: the database holds the row a conflict finds to the policies, so one of another tenant's is refused as `security` where the querier's own enforcement answers a `409`.

**Rejected: native and app enforcement together by default.** It doubles every predicate a statement plans; the native pool proves its role is held instead. **Rejected: views over session variables for MySQL and MariaDB.** Neither has native policies (MariaDB's request is MDEV-27301), and a session variable outlives the request on a pooled connection. **Rejected: a bypass variable**, since any SQL on the connection can set one.

## Proof

- `policy.util.spec.ts`: the polarity of a missing key, the join of allows and musts, the update and delete scopes.
- The shared querier suite on every engine: tenants, authors, a check read back, a project read through its members, no context reaching no row.
- `nativePolicy.test.ts` on Postgres and CockroachDB, as a role held to the policies: no drift after a sync, raw SQL holding a tenant to its rows and refused writing into another, a membership read through its table, a check refused by the database, a superuser refused under a context, a context run as the role it names and one naming a bypassing role refused, row-level security unforced by hand reported critical and forced again, and a table enabled by hand left enabled once uql's policy is gone.

## Next

Surveyed 2026-11-13: MikroORM, Prisma 8 rc, Drizzle beta, TypeORM, ZenStack v3, Hasura, Supabase, PostgreSQL 18 and SQL Server's docs. None ties a foreign key to its tenant; ZenStack alone reads the row before an update (`before()`) and holds fields (`@allow` on a field), both in the app; no TypeScript ORM installs SQL Server's row-level security.

One rule across the four: each is a definition with a data form, holds alike in app and native mode, and its native form reuses what uql already renders (foreign keys, triggers, policies), its shape stated by `dialect.features`.

- **Tenant keys** (next). Where an entity and the one it references both mark a `.tenant()` column on the same context key, the foreign key includes it: `(tenantId, postId)` references `post (tenantId, id)`, and the target gains a unique `(tenantId, id)` where its key does not lead with the tenant. Every SQL engine then refuses a key into another tenant's row, which today is accepted and reads back as `null` through the target's policies, and a join matches on the tenant too. `onDelete: 'SET NULL'` nulls the key column alone, `SET NULL (postId)` on Postgres 15+, and is refused at definition on an engine that cannot name the columns. MongoDB has no foreign keys. A minor release: the upgrade migration adds the unique indexes and replaces the keys, and fails where a key already crosses tenants, which drift reports first.
- **`$old` in a check** (then). An update's check reads the row before it in the trigger language: `check: { $old: { status: 'draft' }, status: { $in: ['draft', 'published'] } }`, and `$old.ownerId` refs where a value compares the two, `{ ownerId: $old.ownerId }`, data as `{ $old: 'ownerId' }`, as `$context` is. App mode reads the old rows in the write's transaction, as a held check reads the new ones; native mode installs a `BEFORE UPDATE` trigger refusing with `42501`, since no policy sees the old row on Postgres or SQL Server. Only a check holding updates may read it.
- **Field policies** (designed, not scheduled). ZenStack's semantics: a field a read policy refuses comes back `null`, and a write touching a field its policy refuses is refused whole. Its shape is open, a key map on the policy so a rename reaches it. Native mode has no per-row column security, only grants per role, so only a `when` on the role key could install. `wire` already keeps a field from every client: build this when a field must differ per user on the server.
- **SQL Server native** (designed, not scheduled). One inline table-valued function per table and statement, the allows ORed and the musts ANDed (one predicate per operation per table), `FILTER` for reads and `BLOCK AFTER INSERT/UPDATE` for checks, the context in `SESSION_CONTEXT`. `node-mssql` does not reset a pooled connection on release (tediousjs/node-mssql#1483), so a context would outlive its request: each transaction must bind every key the entities read, an unbound one as `NULL`, before this ships. App mode already holds every statement on SQL Server.
- **`can()` on the client** and `uql policy explain`.
- **Measured**: `ts.perf` for the section, and a policied read and write per engine, the security barrier's cost on Postgres included.
