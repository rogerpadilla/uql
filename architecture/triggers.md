# Triggers

Design for the [roadmap](roadmap.md)'s triggers item. Depends on R7. Trigger-backed behaviour is Postgres only; the generated-column arm of `computed` is not, and each arm names its own support below.

## What ships

**Two declaration sites.** A column the database computes is a field option; a trigger that is not about one column is an entity option.

| Site                               | Declares                               |
| :--------------------------------- | :------------------------------------- |
| `@Field({ computed, stored, on })` | a column the caller does not write     |
| `@Entity({ triggers: [...] })`     | a trigger that is not about one column |

A trigger is a schema object carrying a table, timing, an event set with its columns, a `when`, a body, a deferral mode and an owner. The authored API writes one; `computed` generates one where it needs one. Same generator, differ, drop ordering and naming. Lowering pays both ways: the aggregate needs a deferral mode and per-event `UPDATE OF` columns, so the authored trigger gets both for free.

### `computed` and the mechanism it picks

One option pair says _this column is computed, not written by the caller_. Which machinery Postgres needs is not an API choice, it is forced. Measured on Postgres 18:

| Expression                                              | Result                                              |
| :------------------------------------------------------ | :-------------------------------------------------- |
| `GENERATED ALWAYS AS (first \|\| ' ' \|\| last) STORED` | legal                                               |
| `GENERATED ALWAYS AS (now()) STORED`                    | **`ERROR: generation expression is not immutable`** |
| `GENERATED ALWAYS AS (n * 2) VIRTUAL`                   | legal, new in PG 18                                 |

A generated column cannot hold `now()`, and none can aggregate across a relation. So:

```ts
@Field({ computed: raw`"first" || ' ' || "last"` })                 // inlined into the statement
@Field({ computed: raw`"first" || ' ' || "last"`, stored: true })   // GENERATED ALWAYS AS ... STORED
@Field({ computed: raw`now()`, on: ['insert', 'update'] })          // BEFORE trigger
@Field({ computed: { resources: { $count: '*' } } })                // correlated subquery
@Field({ computed: { resources: { $count: '*' } }, stored: true })  // AFTER trigger on the child
```

`stored` is one dial across both halves, the promise generated columns already keep: `$select`/`$where`/`$sort` behave the same either way and the result type is unchanged, so flipping it edits no call site.

`on` is what selects a trigger, so nothing infers immutability: UQL cannot know whether a user's `raw` is immutable, and learning it from a rejected migration is a bad error. Naming _when_ a value is stamped is only meaningful for a trigger, and it is information the author has anyway.

`computed` replaced `virtual`, gone since 0.54.0: the rename is what lets `stored: true` read as a dial rather than a contradiction.

## The maintained aggregate

The stored arm over a relation. The aggregate points at a relation that already exists, and the operator says what is maintained:

```ts
@OneToMany({ entity: () => Resource, mappedBy: (resource) => resource.creatorId })
resources?: Resource[];

@Field({ computed: { resources: { $count: '*' } }, stored: true })        resourceCount?: number;
@Field({ computed: { items: { $sum: { amount: true } } }, stored: true })         orderTotal?: number;
@Field({ computed: { resources: { $countInserts: '*' } }, stored: true }) resourceCreatedCount?: number;
@Field({ computed: { resources: { $count: '*' }, $where: { isArchived: false } }, stored: true }) activeCount?: number;
```

`$count` and `$sum` are `QueryAggregateOp` verbatim, and the shape is an aggregate `$select` entry's inner shape with the relation standing where the alias does.

UQL derives from it the trigger, its function, `updatable: false` and `NOT NULL DEFAULT 0` on the column, the backfill in the generated migration, and the resync.

**No index is created for it.** The column takes `index` like any other; auto-creating one would be wrong as often as right, since the case study's `resourceCount` is only ever read by primary key. The trigger's `UPDATE parent SET c = c + <delta> WHERE id = NEW.<fk>` hits the parent's primary key, and the backfill and resync group by the child's foreign key, which migrations already index.

### Which operators ship

An aggregate is maintainable by a trigger only if a row change becomes a delta.

| Operator         | Insert      | Delete                                           | Ships                                                       |
| :--------------- | :---------- | :----------------------------------------------- | :---------------------------------------------------------- |
| `$count`, `$sum` | `+1` / `+x` | `-1` / `-x`                                      | **yes** - invertible, O(1), never reads the children        |
| `$countInserts`  | `+1`        | nothing                                          | **yes** - and it is the only one for which that is correct  |
| `$min`, `$max`   | compare     | **rescan** when the removed row held the extreme | no - different cost model                                   |
| `$avg`           |             |                                                  | no - two columns, not one                                   |
| everything else  |             |                                                  | no - holistic aggregates are not incrementally maintainable |

The same line `pg_ivm` draws. An operator outside the shipping rows is refused at registration, naming the operator and the reason.

`$countInserts` is the one operator an aggregate's `$select` does not have, because it is not a query aggregate: it tallies INSERT events, so it has no delete branch, no backfill and no resync, and drift on one is permanent. It sits beside `$count` on purpose - the place to make two things impossible to confuse is where the author picks between them. The case study's repair migration overwrote a lifetime tally with a live count.

### How the body is derived

**An aggregate is a predicate differentiated.** INSERT adds the delta where NEW matches, DELETE subtracts it where OLD matches, UPDATE applies `(NEW matches) - (OLD matches)` to each side of the edge. One UPDATE branch covers reparenting, filtering in, filtering out, and all three at once. Soft delete needs no special case: it is an UPDATE flipping a default-on `$where` filter, which is already one of the predicate's columns.

This is the only thing the declarative layer does that authoring cannot, and it is the whole reason it exists. An authored trigger reproduces every bug below by construction, because the author writes the body and the branch everyone forgets is the transition.

**Which filters materialize.** A trigger predicate sees only `NEW` and `OLD`, so:

- a `$where` traversing a relation, using `$size`, or needing a subquery is **refused at registration**, naming the key;
- the entity's default-on filters are **included**, soft delete among them, or the aggregate disagrees with the `_count` under its own name;
- a per-request `security` filter is **refused**; it cannot be in a trigger.

**Many-to-many is a trigger on the junction, unfiltered only.** The counted rows are the junction's, so the edge is its local foreign key and the framing applies unchanged. A filtered many-to-many is refused: the predicate lives on the far table, so a junction insert could not evaluate it without a join, and flipping a flag on one `Tag` would fan out to every `User` linked to it.

**One trigger per counted entity and deferral mode.** Aggregates reading the same entity share one generated body, which keeps write amplification flat. Two that disagree about deferral cannot share one, because the mode belongs to the trigger, not the body.

**`UPDATE OF` and `WHEN` keep it cheap**, and both are legal on a deferred constraint trigger. Verified on Postgres 18: an update touching only columns outside the event list never enters the function, and `WHEN` is evaluated when the event is queued, so flipping a predicate on then off inside one transaction queues both deltas and they telescope.

### Deferral

Two modes, one keyword apart, defaulting to `INITIALLY IMMEDIATE`.

| Mode                                            | Written at    | Readable in the writing transaction | `SET CONSTRAINTS` escape |
| :---------------------------------------------- | :------------ | :---------------------------------- | :----------------------- |
| `CONSTRAINT ... DEFERRABLE INITIALLY IMMEDIATE` | statement end | yes                                 | yes                      |
| `CONSTRAINT ... DEFERRABLE INITIALLY DEFERRED`  | commit        | **no**                              | yes                      |

A plain `AFTER ... FOR EACH ROW` trigger is not a third mode: measured on Postgres 18 it is indistinguishable from `INITIALLY IMMEDIATE` after the statement and after commit, differing only in ignoring `SET CONSTRAINTS`. `INITIALLY IMMEDIATE` is the only mode both correct to read in the transaction that wrote the row and escapable per transaction, so a bulk importer gets the lock-contention fix with one `SET CONSTRAINTS ALL DEFERRED` rather than every ordinary read going stale.

## The database-side stamp

```ts
@Field({ computed: raw`now()`, on: ['insert', 'update'] }) updatedAt?: Date;
```

The most common trigger in every codebase surveyed, and the one UQL currently gets wrong. `fillOnFields` stamps `onUpdate` into the payload, so it is right for every write UQL makes and absent from every write it does not - a raw SQL UPDATE, a data migration, a second service. The `on` arm generates the `BEFORE` trigger instead and the ORM stops stamping the column, so there is one writer rather than two that can disagree. It takes no deferral mode, since a constraint trigger cannot be `BEFORE`.

**The column must be read back.** Once the database writes it the in-memory entity is stale unless the write returns it, so the column joins the statement's `RETURNING` list. Hibernate is the prior art and the reason to get it right: it has cooperated with database-generated columns via `@Generated` for years, and 6.5 was largely about returning them in the mutation statement instead of a follow-up `SELECT`.

## The authored trigger

```ts
@Entity({
  triggers: [
    {
      on: { update: ['body'], insert: true },
      timing: 'before',
      when: { body: { $ne: raw`OLD."body"` } },
      run: (c) => raw`NEW.${c.searchVector} := to_tsvector('english', NEW.${c.body}); RETURN NEW;`,
    },
  ],
})
class Post {}
```

- **`on` carries its columns.** `update: ['body']` emits `UPDATE OF "body"`, so a write touching nothing else never enters the function.
- **`when` is a `QueryWhere`, not a string**, compiled against `NEW` with `OLD` reachable as a value. The aggregate's `$where` and an authored `when` are then the same thing compiled the same way: one predicate implementation, one set of tests, and a typo is a compile error rather than SQL that parses and never matches.
- **`run` stays raw.** A trigger body is arbitrary procedural code; pretending otherwise would invent a language. It takes the property-to-column map, so a renamed property is a compile error.

The plpgsql function is generated beside the trigger and dropped with it, because Postgres has no inline body.

**Prerequisite: a DDL render path for an interpolated `raw`.** A `raw` carrying any interpolation compiles to a callback, and `ddlText` refuses exactly that (_"needs raw() with no interpolation, not a function or a bound value"_); `col()` is no help, reading an alias prefix and dialect from a query context absent at DDL time. Authoring needs a render emitting text with an empty prefix and an `addValue` that throws, with the column map resolving through the dialect's naming strategy. `@Entity({ checks })` and a partial index's `where` become interpolatable in the same change.

## Ownership, diff and resync

- **The diff only touches objects it owns, and never by text.** Generated triggers and functions take the `_uql` name prefix; drift compares only those, so the first drift check does not offer to drop every hand-written trigger in the database. The generated body is hashed into `COMMENT ON FUNCTION` and compared by hash, because a database reprints a body from its parse tree. Nothing in UQL emits `COMMENT ON` today, so that is new emission. Putting the hash in the function's _name_ was rejected: it makes every body change a rename.
- **An authored body is created and never compared**, exactly like a check constraint. Its timing, events and `forEach` still are, so a dropped or reshaped one is reported.
- **Resync is a data command, not a schema one.** `drift:check` reports schema drift; this reports data drift. The verification query is the backfill with a comparison, so it is the same generator exposed - `appendRelationSubquery(..., 'COUNT(*)')` already derives it from the relation alone and applies the target's own filters. Recomputing under concurrent writes can lose an insert whose deferred trigger commits after the subquery's snapshot, so resync reports by default and repairs under a lock.
- **TRUNCATE bypasses every aggregate.** A constraint trigger cannot carry a TRUNCATE event. Resync is the answer.
- **Support is per arm, not per feature.** Inlining an unstored `computed` works everywhere. `GENERATED ALWAYS AS` is Postgres 12+, MySQL 5.7+, MariaDB 5.2+ and SQLite 3.31+, with Mongo refusing. Everything trigger-backed - both `on` arms and every stored aggregate - is Postgres only, because deferred constraint triggers and plpgsql do not port. Refuse elsewhere rather than downgrading silently, following `estimatedCount`'s base-throws/subclass-overrides pattern or the `indexFeatures` capability set.

## Typing

The relation name is checked at compile time. `Field(opts)` resolves before it knows its class, but `ClassFieldDecoratorContext<This, Value>` carries `This`, inferred where the decorator is applied: the relation decorators already read their declaring class that way for `references`. The check rides on the returned decorator's `context` parameter, gated behind a conditional return type so only a field carrying a relation `computed` pays for it: ungated, about 41 extra instantiations on every decorated field; gated, four. Verified against self-references, inherited fields and forward references, none circular.

## What the trigger arms add to the existing code

The generated-column arm already made the option rules conditional: `FIELD_OPTION_FAMILY` (`util/fieldOption.util.ts`) is `satisfies Record<keyof FieldOptions, ...>`, and `deadOn` treats a stored `computed` as the real column it is. `on` has to be placed there too, and a stored aggregate reads and migrates like a stored generated column, so the new work is the trigger itself.

## Not in this release

- **`$min`/`$max`**, which need a rescan on delete. Different cost model, stated when they land.
- **Multi-level aggregates.** `counter_culture` counts through a chain of relations; a trigger fires on the child and a grandchild's insert never touches the child's row. Refused rather than half-supported.
- **Statement-level bodies with transition tables.** A constraint trigger refuses both `FOR EACH STATEMENT` and `REFERENCING ... NEW TABLE` as syntax errors, so a deferred aggregate is per-row always and a bulk insert of N rows issues N UPDATEs. Transition tables would collapse that to one, and the two cannot be had together. It replaces the body rather than a keyword, so it is its own option later.
- **Reading an aggregate from `$count`, `$size` or `$sort` automatically.** It needs a predicate-equivalence engine, and it makes a query's correctness depend on a column declared elsewhere: adding one would silently change an unrelated call site, and a drifted one would make a previously-correct read wrong. Selecting the column is how you ask for the cheap answer, visibly.

## Why

The case study is Variability: nineteen counter columns kept by five triggers, **459 lines of SQL across four migrations**, 125 of them hand-written `down`. Five bugs, none of which a test would have caught.

- `'queryCount'` passed to a trigger on `Search`, a column `Workspace` does not have, while `Search.workspaceId` is `nullable: false` - so the branch always runs and aborts at COMMIT, swallowed by a fire-and-forget `.catch(log)`. Search history is entirely dead.
- `Resource.messageCount` and `messageCreatedCount` declared, never added by a migration, never written by the function. They exist in e2e, which builds from the entities, and not in production, which came from a dump.
- No UPDATE branch, so `PUT /api/resources/move` re-parents a resource and both workspaces are permanently wrong.
- `resourceCount` counts archived rows the Library list excludes; its one consumer compensates by hand and says so in a comment.
- The repair migration sets `resourceCreatedCount = resourceCount`, destroying the distinction it exists to keep.

The migrations are also name-sorted, and one calls a function only a later-sorting file creates. Generated DDL is ordered by its dependency graph, which is what R7 exists to settle.

Independent evidence, since one application is not evidence. A census of every trigger in every unrelated codebase to hand found four: three `updated_at` stampers and one NOTIFY, and no counters at all - so the case for the aggregate is not frequency. `django-pgtrigger` has fourteen cookbook recipes and no counter. Rails has the opposite: `counter_cache` is core ActiveRecord, and `counter_culture` exists because the built-in one misses the reparent branch, arriving independently at conditional counters, a `fix_counts` repair command, and `execute_after_commit: true` for deadlocks - three decisions above, reached from the other direction.

Across ecosystems, the two halves are always split and the second half is always missing.

|                                | Authors triggers                                                                           | Diffs them                          | Maintained aggregate |
| :----------------------------- | :----------------------------------------------------------------------------------------- | :---------------------------------- | :------------------- |
| **hair_trigger** (Rails)       | yes - declared on the model, `.of(:name)` is `UPDATE OF`, a rake task writes the migration | via migrations                      | no                   |
| **django-pgtrigger**           | yes - fourteen cookbook recipes                                                            | yes                                 | no                   |
| **alembic_utils** (SQLAlchemy) | yes - triggers, functions, views, policies as first-class objects                          | yes - real autogenerate             | no                   |
| **Atlas**                      | yes - `trigger` block with `update_of`, ROW/STATEMENT                                      | yes - the best diff engine here     | no                   |
| **MikroORM 7**                 | yes - `TriggerDef` with a column map                                                       | yes                                 | no                   |
| SQLAlchemy 2.0 core            | no construct; DDL event listeners and raw SQL                                              | no - Alembic does not see DDL hooks | no                   |
| Hibernate 6                    | no - but `@Generated` cooperates with a column the database writes                         | no                                  | no                   |
| EF Core 7+                     | no - `HasTrigger()` only declares that one exists, so writes drop the `OUTPUT` clause      | no                                  | no                   |
| Doctrine, ent, GORM, TypeORM   | no - application-level lifecycle hooks only                                                | no                                  | no                   |
| Prisma, Drizzle                | no construct at all                                                                        | no                                  | no                   |
| Sequelize                      | imperative `queryInterface.createTrigger`                                                  | no                                  | no                   |

`hair_trigger` is the closest prior art for the authored layer and got there in 2011; Atlas has the strongest diff engine, though triggers are a paid feature there and it carries no `when` or deferrable; `alembic_utils` is the best autogenerate story. Against that, two things stay unclaimed: a `when` that is a typed condition rather than a SQL string, and a **maintained aggregate**, which nothing in the table has. Rails has the aggregate and puts it in the application, which is why `counter_culture` ships `fix_counts`; the trigger libraries have the mechanism and no aggregate built on it.

The standard objection is that triggers hide logic outside source control, cannot be stepped through in a debugger, and _"often exist only in the production environment and not in development installations."_ Every one of those describes a trigger that was never **declared** - and the third is the case study's second bug exactly. A declared trigger is in source control, in every environment, and reported when it drifts. The debugger point stays true and is a real cost.
