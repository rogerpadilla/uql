# Triggers

Design for the [roadmap](roadmap.md)'s triggers item: what a column the database derives needs beyond the generated column that already shipped. The unstored aggregate needs nothing more and runs on every engine; everything a trigger stores waits for R7.

## One option, one dial

`computed` says what the database derives; `stored` says when it recomputes. What the callback returns and what `stored` holds pick the machinery, so no option names it.

```ts
@Field({ type: String, computed: (u) => raw`${u.first} || ' ' || ${u.last}` })               readonly fullName?: string;
@Field({ type: String, computed: (u) => raw`${u.first} || ' ' || ${u.last}`, stored: true }) readonly fullName?: string;
@Field({ computed: (u) => u.resources.count() })                                              readonly resourceCount?: number;
@Field({ computed: (u) => u.resources.count(), stored: true })                                readonly resourceCount?: number;
@Field({ type: Date, computed: raw`now()`, stored: ['update'] })                              readonly updatedAt?: Date;
```

| `stored`               | The database recomputes     | SQL expression                                                                      | Relation aggregate             |
| :--------------------- | :-------------------------- | :---------------------------------------------------------------------------------- | :----------------------------- |
| `false`, the default   | never: each read derives it | spliced into the statement                                                          | read in the parent's statement |
| `true`                 | whenever an input changes   | `GENERATED ALWAYS AS (...) STORED`                                                  | `AFTER` triggers on the child  |
| `['insert', 'update']` | on the events listed        | a `BEFORE` trigger; `ON UPDATE CURRENT_TIMESTAMP` on the MySQL family for the clock | refused                        |

- **SQL names its type; an aggregate is its type.** A `raw` says nothing about what it returns, so it carries `type`; `count()` returns a number, so it carries none.
- **Flipping `stored` edits no call site.** `$select`, `$where` and `$sort` read the field the same way on either side, and the result type does not move. Start unstored; store what profiling names.
- **An event list is what selects a stamp**, so nothing infers immutability. `GENERATED ALWAYS AS (now()) STORED` fails on Postgres 18 with _generation expression is not immutable_, UQL cannot know whether a `raw` is immutable, and learning it from a rejected migration is a bad error.
- **A field the database writes is `readonly`**, and write payloads leave it out (below). Its value never reaches the database from UQL, so the type should never let a caller think it does.

## Typing

Verified by type-checking these shapes in memory against a copy of `Field` and `Entity` as they are declared today.

**`Field` takes two overloads.** The column overload is today's signature, with `stored` widened to take an event list; its SQL callbacks see `RefMap<E>` alone. The aggregate overload's callback sees `RefMap<E> & RelationRefs<E>` and returns an `Aggregate<V, Storable>`: `stored: true` is accepted only where `Storable` is `true`, and the field's value is `V`.

```ts
@Field({ computed: (u) => u.resources.count({ isArchived: { $ne: true } }), stored: true }) readonly activeCount?: number;
@Field({ computed: (o) => o.items.sum((item) => item.amount), stored: true })               readonly total?: number;
@Field({ computed: (p) => p.bids.max((bid) => bid.amount) })                                 readonly topBid?: number | null;
```

- **The relation is read off a ref, never named by a key**, as every definition names a member. A relation the class lacks is a compile error, since `This` is inferred where the decorator is applied (`rename.test-d.ts`).
- **The aggregate's `where` is an `EntityPredicate` of the child**, the type checks and partial indexes already take. A misspelled child field, a value of the wrong type, and a relation, `$text` or `$exists` inside it are all compile errors.
- **A page names the order that picks it.** `count` takes the `$limit` `count` itself takes and no `$sort`, since an order changes which rows a page holds and never how many; a value aggregate reading only some rows takes `$sort` with `$limit`, because a total over five of them is defined by nothing else. Capping makes an aggregate unstorable, which its type states. The keys are the relation read's own (`Pick<RelationQuery<C>, ...>`), so an aggregate's page and a `$populate`'s cannot drift.
- **It reads on every engine.** The declaration is data, not SQL, so each renders it: a correlated subquery on SQL, a `$lookup` ending in a `$count` or a `$group` on MongoDB, which also answers `0` or `null` over no rows. A `computed` field writing SQL stays SQL-only, and MongoDB refuses one a query names.
- **`count` and `sum` are the storable aggregates, in the type.** A stored `max` fails to compile, as does an event list on any aggregate. `sum` takes numeric fields only. Until the triggers below are built, `stored: true` is refused at registration: the aggregate reads as a subquery, which no engine keeps in a generated column.
- **The property must equal the aggregate's value.** Today's check is one-way, since a decorator context accepts a property narrower than its value, so a `number` property would take `max()`'s `number | null`. The aggregate overload checks both directions and names the mismatch (`__propertyMustAdmit: number | null`). `count` and `sum` are never null - stored, the column is `NOT NULL DEFAULT 0`; unstored, the read is `COALESCE(..., 0)` - while `min`, `max` and `avg` are nullable, since an empty set has no extreme.
- **A write payload leaves `readonly` fields out.** `EntityData` and `UpdatePayload` default their key set to `WritableKey<E>`, which drops a key whose `Pick` differs from its mutable copy. `insert(User, { resourceCount })`, `update(...)` with one, and `user.resourceCount = 2` are compile errors; reads, hydration and `$select` are untouched. A decorator cannot see `readonly`, so on a class it is a convention a missing modifier merely leaves unenforced; `defineEntity`, which writes the entity type itself, marks every database-written field `readonly`.
- **Only aggregates pay.** Per entity, in instantiations: a plain one costs the same as today (70.8), one with a SQL `computed` the same (116 against 117), and one with a stored count 197. The exact check adds about 35 per aggregate field. A single union constraint also type-checked but charged every plain entity 16% more, which is why it is two overloads.

## The maintained aggregate

`stored: true` over a relation. UQL derives the triggers and their function, the column - `bigint NOT NULL DEFAULT 0` for a count, read through `decodeWideNumber`, and the summed field's type for a sum - the backfill, and the check that finds drift.

**An aggregate field loads when asked** (`eager: false`), stored or not, as a relation does: a user loaded on every request should not recount anything. Flipping `stored` still edits no call site.

**No index is created for it.** The trigger's `UPDATE parent SET c = c + <delta> WHERE <key> = NEW.<fk>` hits the parent's key, pairing every column of a composite one, and the backfill groups by the child's foreign key, which migrations already index.

### Which aggregates store

A trigger maintains an aggregate only if a row change becomes a delta.

| Aggregate      | Insert      | Delete                                           | Stored                                               |
| :------------- | :---------- | :----------------------------------------------- | :--------------------------------------------------- |
| `count`, `sum` | `+1` / `+x` | `-1` / `-x`                                      | **yes** - invertible, O(1), never reads the children |
| `min`, `max`   | compare     | **rescan** when the removed row held the extreme | no - a different cost model                          |
| `avg`          |             |                                                  | no - two columns, not one                            |

The same line `pg_ivm` draws, drawn in the type.

A lifetime tally - every row ever created, deleted ones included - is not an aggregate: it has no delete branch and nothing to recount it from, so drift on one is permanent. Count a table that keeps its rows instead, soft-deleted and read through `withDeleted`.

### How the body is derived

**An aggregate is a predicate differentiated.** INSERT adds the delta where NEW matches, DELETE subtracts it where OLD matches, and UPDATE applies `(NEW matches) - (OLD matches)` to each side of the edge. One UPDATE body covers reparenting, filtering in, filtering out, and all three at once; soft delete is an UPDATE flipping a default-on filter, which is already one of the predicate's columns. Each side is `coalesce(pred, false)`, since a predicate is three-valued and a delta is not.

This is the only thing the declarative layer does that authoring cannot, and the reason it exists: the branch every hand-written counter forgets is the transition.

**The child's default-on filters are included**, soft delete among them, or the column disagrees with the `_count` under its own name. Two refusals stay at run time, since no type can see them: a per-request `security` filter, and a filtered many-to-many, whose predicate lives on the far table where a junction insert cannot read it. An unfiltered many-to-many is a trigger on the declared `through` entity, whose own rows are the ones counted.

**One function, three single-event triggers**, shared by every aggregate reading the same child: `afterInsert`, `afterDelete`, and `afterUpdate` with `changed` set to the keys and predicate columns - the same machinery an authored trigger uses, below. Single-event triggers are what make `WHEN` legal everywhere, since Postgres refuses one naming `OLD` on an INSERT.

**Not a constraint trigger.** Measured on Postgres 18, `CONSTRAINT ... DEFERRABLE INITIALLY IMMEDIATE` behaves as a plain `AFTER` row trigger after the statement and after commit, adding only `SET CONSTRAINTS`. Deferral buys a shorter lock window on the parent and no correctness, while a constraint trigger refuses `OR REPLACE`, `FOR EACH STATEMENT` and transition tables.

**The function runs as its owner.** A role allowed to insert children but not to update the parent, or row-level security on the parent, would otherwise fail every child write. It is `SECURITY DEFINER`, owned by the migration role, schema-qualifies its tables and pins `search_path`. Authored triggers run as the invoker.

**The body is engine-neutral.** It is rows of `(parent table, key, delta, predicate)` rendered as `UPDATE`s, not procedural logic. Postgres ships first; SQLite, MySQL and MariaDB row triggers are a renderer each, and SQL Server's statement-level `inserted`/`deleted` is the set-based form. CockroachDB takes no `UPDATE OF` in a trigger ([known limitations](https://www.cockroachlabs.com/docs/stable/known-limitations)), so its renderer emits `changed` as the `WHEN` alone.

**Refused where it would count twice or cannot run:**

- an edge whose foreign key cascades on update, since `ON UPDATE CASCADE` rewrites the children, and the trigger would then move a count that the key change had already moved;
- a child that is its own parent on the MySQL family, whose triggers cannot update the table that fired them.

## The database-side stamp

```ts
@Field({ type: Date, computed: raw`now()`, stored: ['update'] }) readonly updatedAt?: Date;
```

The most common trigger in every codebase surveyed. `fillOnFields` stamps `onUpdate` into UQL's own writes and misses every other writer: a raw UPDATE, a data migration, a second service. An event list moves the stamp into the database and the ORM stops writing the column, so there is one writer. Postgres takes a `BEFORE` row trigger; the MySQL family takes its native `ON UPDATE CURRENT_TIMESTAMP` when the stamp is the clock, which the migration builder already emits as `onUpdateNow`.

Nothing reads it back. A UQL write returns ids and counts, never rows, exactly as for a stored generated column; the next read has the value.

## The authored trigger

The escape hatch, and the last of these to build: once aggregates and stamps are declared, the census below has one trigger left, a NOTIFY.

```ts
const tsvectorOf = (row: RefMap<Post>) => raw`${row.searchVector} := to_tsvector('english', ${row.body});`;

@Entity({
  triggers: {
    beforeInsert: { run: tsvectorOf },
    beforeUpdate: { changed: (post) => [post.body], run: tsvectorOf },
    afterUpdate: {
      changed: (post) => [post.status],
      run: (row) => raw`PERFORM pg_notify('post_status', ${row.id}::text);`,
    },
  },
})
```

- **Keyed by event**, with the names hooks already use; upsert has no key, since `INSERT ... ON CONFLICT` fires the insert or the update triggers row by row. A key takes one trigger or a list, fired in list order: the generated names carry the position, and Postgres fires same-event triggers by name.
- **The event fixes `run`'s parameters.** `(row)` on insert, `(row, old)` on update, `(old)` on delete; `row` renders `NEW."col"` and `old` renders `OLD."col"`. Reaching for `old` on an insert is a compile error, not a runtime refusal, and no body spells `NEW.` or `OLD.` itself.
- **`changed` exists only on update keys.** A member-list callback, emitted as `UPDATE OF` plus `WHEN (OLD.c IS DISTINCT FROM NEW.c OR ...)`: the filter nearly every update trigger wants, typed and with no SQL.
- **`when` is an `EntityPredicate<E>`**, compiled against the event's row by the same compiler as an aggregate's `where`, or a SQL callback taking `run`'s parameters.
- **`run` stays raw**, written for the engine it runs on. A trigger body is procedural code; pretending otherwise would invent a language.
- **The generator owns the boilerplate.** It adds `RETURN NEW` or `RETURN NULL` by timing - a `BEFORE` body that returns nothing silently skips the row - and wraps the body in a function with its tables schema-qualified and `search_path` pinned.
- **Reuse is a TypeScript function over refs**, as `tsvectorOf` above. It is the checked form of `TG_ARGV`, whose column names are strings nothing checks. There is no function object; a standalone function or an extension becomes an R7 schema object when something needs one.

## Ownership, drift and recount

- **The diff touches only what it owns.** Every trigger and function UQL creates takes the `_uql` prefix, and drift compares only those, so the first check does not offer to drop every hand-written trigger in the database - the reason MikroORM grew `ignoreTriggers`. It does warn about a trigger it does not own on a table it maintains an aggregate from: that is a second writer, and adopting UQL over hand-written counters drops them in the migration that creates their replacement.
- **Compare what UQL rendered, never the engine's reprint.**
  - Postgres reprints a body from its parse tree, so each function carries its rendered body's hash in `COMMENT ON FUNCTION`, read back beside `pg_trigger`'s timing, events and `tgattr`. SQLite keeps a trigger's text verbatim and compares it directly.
  - A body change is `CREATE OR REPLACE FUNCTION`; a shape change is `CREATE OR REPLACE TRIGGER`. A release that renders differently replaces each function once, which locks no table.
  - A hash in the function's _name_ was rejected: it would make every body change a rename.
- **`sync` creates them too.** A test database built from the entities then carries the same triggers as production, which is exactly what the case study's never-written counters lacked. PGlite runs PL/pgSQL, so in-process tests exercise the real ones.
- **Storing an aggregate is two steps.**
  - First, the column and the triggers commit together.
  - Then the backfill walks the parents. Each is locked with `SELECT ... FOR UPDATE` and recounted in a new statement. Under READ COMMITTED that is exact: a writer whose trigger reached the parent first commits before the recount's snapshot, and one arriving later adds its delta on top.
  - No child write waits for more than one parent, and the column reads low until the walk ends. The backfill runs outside the migration's transaction, which is the roadmap's non-transactional migration.
  - Unstoring drops the triggers and the column.
- **Drift in the data is its own check.** `aggregate:check` compares each stored aggregate with its recount, and `--repair` walks the parents the same way; `drift:check` stays about the schema. It is the answer to every write no row trigger sees: TRUNCATE, a session under `session_replication_role = replica` (bulk loaders, logical replication), and `DISABLE TRIGGER`.
- **A refusal lives where its layer knows enough.** Shapes are refused by the types. The run-time refusals - a `security` filter, a filtered many-to-many, a cascading key, a self-parent on MySQL - are refused at registration. An engine without a renderer is not a shape, and registration has no dialect, so it is refused in `buildEntityAST` beside `compileDdl`. MongoDB refuses everything stored and reads everything unstored.

## Build order

1. **Relation refs and the unstored aggregate.** No R7, every engine, the same operators and compile path as the roadmap's relation aggregates, plus the two overloads and `WritableKey`. Enough on its own for the case study below.
2. **After R7, on Postgres:** stored aggregates and event lists, then authored triggers. They need:
   - `SchemaDiffResult` flattened, since it has one field per kind (`schema/types.ts`);
   - a `pg_trigger`/`pg_proc` introspector;
   - row-qualified refs (`row`/`old`) in `compileDdl`, which qualifies nothing today;
   - trigger-backed rows in `FIELD_OPTION_FAMILY`/`deadOn`, since `GENERATED_WRITES` kills `defaultValue` on anything `computed` while a stored aggregate derives one;
   - a migration step outside the transaction, for the backfill.
3. **Other engines**, a renderer each.

The typing above is verified; the runtime claims are reasoned from the Postgres documentation and owed an integration suite, on Postgres and PGlite. It covers insert and delete, reparenting, a filter flip, soft delete, a backfill racing concurrent writes, and `aggregate:check` after TRUNCATE.

## Not in this design

- **Stored `min`/`max`**: a rescan on delete is a different cost model.
- **Multi-level aggregates.** `counter_culture` counts through a chain of relations, but a trigger fires on the child, and a grandchild's insert never touches the child's row. Refused rather than half-supported.
- **Statement-level bodies with transition tables.** A row trigger issues one UPDATE per child row; `REFERENCING NEW TABLE` collapses a bulk write to one statement. Postgres takes it only on a single-event trigger - the shape these already have - and without `UPDATE OF`, so it is a flag later rather than a redesign.
- **A hot parent.** Every writer of its children serializes on the parent's row, and under REPEATABLE READ or SERIALIZABLE the losers see serialization failures to retry. Deferral only shortens the wait. Statement-level bodies, which update parents in key order and so cannot deadlock one another, and a sharded counter are the fixes.
- **Reading a stored aggregate for `$count`, `$size` or `$sort` automatically.** It needs a predicate-equivalence engine, and it makes a query's correctness depend on a column declared elsewhere: adding one would silently change an unrelated call site, and a drifted one would make a previously correct read wrong. Selecting the field is how you ask for the cheap answer, visibly.

## Why

The case study is Variability, read from its production database on Postgres 18.4.

| In production                                                                                                                                             | Under this design                                                                       |
| :-------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| One function, `app_sync_entity_count()`, with the parent tables hard-coded and the counter columns passed as `TG_ARGV` strings into `EXECUTE format(...)` | nothing                                                                                 |
| Five `CONSTRAINT ... AFTER INSERT OR DELETE DEFERRABLE INITIALLY DEFERRED` triggers                                                                       | nothing                                                                                 |
| Seventeen counters on `User` and `Workspace` that the triggers keep                                                                                       | `resourceCount` and `threadCount` as `computed: (u) => u.resources.count()`; 15 dropped |
| `Resource.messageCount`, `Resource.messageCreatedCount` and `Transcript.captionsCount`, declared and never written                                        | dropped                                                                                 |

**Two of the twenty counters have a reader, and both only size a loading skeleton**, one of them capped at a page. Folders and people already count at query time. Every bug below came from storing a count nobody needed stored:

- **Search history has been dead since February.** `'queryCount'` is passed to the trigger on `Search`, but `Workspace` has no such column, and `Search.workspaceId` is `nullable: false`, so the failing branch always runs. Every insert aborts at COMMIT, and a fire-and-forget `.catch(log)` swallows the error. The table's last row is dated 2026-02-26, the date of the migration that made the triggers deferred.
- **Three counters are declared and never written.** `Resource.messageCount` and `messageCreatedCount` are wrong on 28 of 175 resources. `Transcript.captionsCount` is null on all 173 transcripts, 165 of which have captions.
- **There is no UPDATE branch**, so moving a resource between workspaces leaves both counts wrong for good. The bug is latent: the counters show no drift today.
- **`resourceCount` counts archived rows** the Library list excludes, and its consumer compensates by hand.
- **The repair migration set `resourceCreatedCount = resourceCount`**, destroying the distinction the column existed to keep.
- **The migrations themselves:** 459 lines of SQL across four name-sorted migrations, 125 of them a hand-written `down`, and one calls a function that only a later-sorting file creates. Generated DDL is ordered by its dependency graph, which is what R7 settles.

**Independent evidence**, since one application is not evidence.

- A census of every trigger in every unrelated codebase to hand found four: three `updated_at` stampers and one NOTIFY, and no counters.
- `django-pgtrigger` has fourteen cookbook recipes and no counter either.
- Rails is the exception: `counter_cache` is core ActiveRecord, and `counter_culture` exists because the built-in one misses the reparent branch. It arrives independently at conditional counters and at a `fix_counts` repair command.

| Library                        | Authors triggers                                                                           | Diffs them                                                           | Maintained aggregate |
| :----------------------------- | :----------------------------------------------------------------------------------------- | :------------------------------------------------------------------- | :------------------- |
| **hair_trigger** (Rails)       | yes - declared on the model, `.of(:name)` is `UPDATE OF`, a rake task writes the migration | via migrations                                                       | no                   |
| **django-pgtrigger**           | yes - fourteen cookbook recipes                                                            | yes                                                                  | no                   |
| **alembic_utils** (SQLAlchemy) | yes - triggers, functions, views, policies as first-class objects                          | yes - real autogenerate                                              | no                   |
| **Atlas**                      | yes - `trigger` block with `update_of`, ROW/STATEMENT                                      | yes - the best diff engine here                                      | no                   |
| **MikroORM 7.2**               | yes - `@Trigger`/`triggers`, a body callback over the column map, on five engines          | yes - by body text, with `ignoreTriggers` to spare hand-written ones | no                   |

**Everything else stops short.**

- Prisma 8, Drizzle 1.0 and Kysely have no trigger construct.
- TypeORM, Doctrine, ent and GORM stop at application-level hooks.
- Sequelize has an imperative `queryInterface.createTrigger` and no diff.
- EF Core's `HasTrigger()` only declares that a trigger exists.
- The unstored arm has prior art in TypeORM's `@VirtualColumn({ query })` and MikroORM's `formula`: subqueries written by hand, not aggregates typed from a relation.

**What no one has:** a body whose `NEW`/`OLD` references are typed, and a maintained aggregate that starts life as a read. Rails puts its aggregate in the application, which is why `counter_culture` ships `fix_counts`; the trigger libraries have the mechanism and build no aggregate on it.

**The standard objection** is that triggers hide logic outside source control, cannot be stepped through in a debugger, and _"often exist only in the production environment and not in development installations."_ Every one of those describes a trigger that was never **declared**. A declared trigger is in source control, in every environment, and reported when it drifts. The debugger point stays true, and it is a real cost - one more reason the default is unstored.
