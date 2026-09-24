# Triggers

What `stored` adds beyond the generated column: a stamp the database writes, an aggregate the database keeps, and a trigger you author. The unstored relation aggregate shipped in 0.69.0.

**Built, on every SQL engine:** authored triggers, stamps, and the reconciliation that installs what an entity declares and drops what it no longer does. MongoDB runs no trigger within a write, so it refuses an entity declaring one: [why](#mongodb).

**Designed, not built:** the maintained aggregate. It is the one arm nothing else offers and the one nobody has asked for - not in any surveyed ORM's issue tracker, not in django-pgtrigger's recipes after
years in production. Build it when someone profiles an _unstored_ relation aggregate and finds it too slow; until then the unstored form does the job with no backfill, no drift and no repair command.

## One dial

`computed` says what the database derives, `stored` when it recomputes, and together they pick the machinery.

```ts
@Field({ type: String, computed: (u) => raw`${u.first} || ' ' || ${u.last}`, stored: true }) readonly fullName?: string;
@Field({ computed: (u) => u.resources.count() })                                              readonly resourceCount?: number;
@Field({ computed: (u) => u.resources.count(), stored: true })                                readonly resourceCount?: number;
@Field({ type: Date, computed: raw`CURRENT_TIMESTAMP`, stored: ['update'] })                  readonly updatedAt?: Date;
```

| `stored`               | SQL expression                                         | Relation aggregate             |
| :--------------------- | :----------------------------------------------------- | :----------------------------- |
| `false`, the default   | spliced into each statement                            | read in the parent's statement |
| `true`                 | `GENERATED ALWAYS AS (...) STORED`                     | kept by triggers on the child  |
| `['insert', 'update']` | a trigger per event, assigning the row or restating it | refused                        |

- **Flipping `stored` edits no call site.** Every clause reads the field the same way and its type does not move. Start unstored; store what profiling names.
- **An event list is what selects a stamp.** `GENERATED ALWAYS AS (now())` is rejected as not immutable, and UQL cannot tell whether a `raw` is. The MySQL family's `ON UPDATE CURRENT_TIMESTAMP` is not used for one: it stamps the clock and nothing else, where a stamp is any expression.
- **The aggregate's types are in place, ahead of its mechanism.** `stored: true` compiles only on a `count` or `sum` with no page, and the property must equal the aggregate's value - but registration still throws on one, since no engine keeps a subquery in a generated column. That throw is what the unbuilt arm would replace.

## The maintained aggregate

UQL generates the column (`bigint NOT NULL DEFAULT 0` for a count, the field's type for a sum), the function and its triggers, the backfill, and the check that finds drift. It loads only where a query names it, stored or not.

**Its `bigint NOT NULL DEFAULT 0` is implied, not stated.** Derived in `definition.ts` once the entity is whole, the way `version: true` already implies its own, so it lands after `fieldOptionConflict` has run and `stored: true` keeps refusing a written `defaultValue`.

**Only `count` and `sum` store**, since only they turn a row change into a delta: `+1`/`-1`, `+x`/`-x`. A `min` or `max` must rescan when the extreme is deleted, and an `avg` is two columns. A lifetime tally, deleted rows included, is not an aggregate: count a soft-deleting table through `withDeleted` instead.

**The body is the predicate, differentiated.** An insert adds where `NEW` matches, a delete subtracts where `OLD` matches, and an update applies `(NEW matches) - (OLD matches)` to both parents. That one update branch covers reparenting, filtering in and out, and soft delete, which is the branch every hand-written counter forgets. Each side is `coalesce(pred, false)`, since a predicate can be `NULL`.

**The child's default-on filters are part of the predicate**, soft delete included, so the stored column agrees with the unstored one.

**One function and three single-event triggers per child** (`afterInsert`, `afterDelete`, and `afterUpdate` with `of` set to the keys and predicate columns): the machinery an authored trigger uses. The function is `SECURITY DEFINER` with `search_path` pinned, so a writer allowed the child but not the parent, or row-level security on the parent, cannot fail every insert. It is a plain `AFTER` trigger, not a deferred constraint trigger: deferral only shortens the parent's lock.

**On each engine**, the body is rows of `(parent, key, delta, predicate)` rendered as `UPDATE`s. SQLite, MySQL and MariaDB take row triggers; SQL Server takes the set-based `inserted`/`deleted`; CockroachDB has no `UPDATE OF` and no usable `WHEN`, so its guard goes in the body.

**Refused:**

- a per-request `security` filter, which no trigger can see;
- an edge whose foreign key cascades on update, which would move the count twice;
- a child that is its own parent on the MySQL family, whose triggers cannot update their own table;
- a filtered many-to-many, until the target gets a second trigger for the columns that flip the filter.

## The database-side stamp

```ts
@Field({ type: Date, computed: raw`CURRENT_TIMESTAMP`, stored: ['update'] }) readonly updatedAt?: Date;
```

**`onUpdate` already lets the database compute it.** `@Field({ type: Date, onUpdate: raw`CURRENT_TIMESTAMP` })` puts it in the `SET` list of the statement uql emits, and that is the whole feature for most callers. What an event list adds is not who computes the value but **which writes are stamped**: `onUpdate` reaches only the statements uql writes, so a `psql` session, a data migration, `pool.run('UPDATE ...')` or a second service on the same database all slip past it. A trigger catches them. Reach for one only when a write outside uql has to stamp too.

One trigger per event, named for the field and the event, so a stamp on both writes installs two rather than having the second replace the first. Where a body may assign to the row it was handed it does; where it may not - SQLite forbids writing `NEW`, SQL Server is handed a set - the trigger fires after the write and restates the row as an `UPDATE` keyed on its own id.

## The schema-scoped object

An extension, a function, a domain: declared once beside the entities, applied by `sync`, by `up` and by
whatever a test bootstraps with.

```ts
export default {
  pool,
  entities: [Caption, Resource],
  objects: [
    { kind: 'extension', name: 'pg_trgm' },
    {
      kind: 'function',
      name: 'immutable_unaccent(text)',
      run: raw`RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
               AS $$ SELECT public.unaccent('public.unaccent', $1) $$`,
    },
  ],
} satisfies Config;
```

- **A function is identified by its signature, not its name.** `immutable_unaccent(text)` and
  `immutable_unaccent(text, text)` are two functions that coexist, so the argument types are part of what
  names one.
- **They hang off no table**, which is why a derived object's ref carries an optional one rather than a
  required one: the same identity covers a check on `Post` and an extension on nothing.
- **They are created before the tables that use them**, an extension before the function wrapping it and
  the function before an index calling it, through the ordering `createOrder` already does for tables.

## The authored trigger

The escape hatch, and what most of the demand is actually for.

```ts
const tsvectorOf = (newRow: RefMap<Post>) => raw`${newRow.searchVector} := to_tsvector('english', ${newRow.body});`;

@Trigger(
  { on: 'beforeInsert', run: (newRow) => tsvectorOf(newRow) },
  { on: 'beforeUpdate', of: (post) => [post.body], run: (newRow) => tsvectorOf(newRow) },
  {
    on: 'afterUpdate',
    of: (post) => [post.status],
    where: { $new: { archived: false } },
    run: (newRow) => raw`PERFORM pg_notify('post_status', ${newRow.id}::text);`,
  },
)
@Entity()
```

- **A list, as `checks` and `indexes` are**, not a map keyed by event. A trigger is a table-level object that is named, diffed and dropped by name, and several can share an event; keying by event would need a `Trigger | Trigger[]` union at every key and leave the firing order implicit. `on` is a value rather than a member name, so it also discriminates the union that types `run`'s parameters, and it gives a `@Trigger(...)` decorator mirroring `@Index`. No upsert event: `ON CONFLICT` fires the insert or update triggers.
- **Entity level, never field level.** A trigger is a table object; hanging one off a field would either merge several fields' declarations behind the author's back or fire one trigger per field. The field-shaped case is the generated column above, which needs no trigger at all.
- **`run` takes `(newRow, oldRow)` on every event**, the SQL standard's `NEW ROW` and `OLD ROW`, rendering `NEW."col"` and `OLD."col"`; `where` names them `$new` and `$old`. The row an event lacks is typed `never`, so reading it does not compile, and since each keeps its place a delete body is `(_newRow, oldRow)` and one body serves an update and a delete alike. One declaration per event, a shared body by a plain function, rather than `on` as a list.
- **`of`, on update only,** emits `UPDATE OF` plus `WHEN (OLD.c IS DISTINCT FROM NEW.c ...)`, reading beside `on` as the SQL does: `on: 'beforeUpdate', of: [post.body]`. **`where`** is a further condition over the same rows `run` reads: a predicate keyed by the row it names, `$`-marked like the operators inside it so it never reads as a field, `{ $old: { status: 'draft' }, $new: { status: 'published' } }`, which is how a transition is stated, or a SQL callback. One shape keyed by row rather than a bare predicate with a row picked for it, so the event's rows type it exactly as they type `run`.
- **The author names the declaration; uql owns the identifier.** `name` is a label within the entity, and what is installed is `_uql_<table>__<label>_<hash>`, clamped to the shortest identifier every engine takes, the hash kept whole. Ownership is the prefix, since no engine records who created an object, and carrying the table keeps two entities sharing a label apart where an engine scopes trigger names to the schema rather than to the table (everywhere but the Postgres family).
- **`run` returns SQL**; the generator adds the function wrapper and `RETURN NEW`/`NULL`. The common body, a write to another table, is `insertInto`/`updateTable`/`deleteFrom`, rendered by the dialect's `triggerWrite` rather than its request writes: only the fields named, since a JavaScript fill would be baked in as a constant, and an insert refused where it leaves out one uql fills on insert with no column default to stand in; no id read back; no entity filter, a security one included, since a request resolves those and a trigger serves none (the `where` guard compiles the same way, through `compileDdl`); and on SQL Server a `FROM` over `inserted`/`deleted`, where `$inc`, `$mul` and `$push` are refused because a set-based `UPDATE` writes each target once. The rest is raw SQL for its engine. Reuse is a plain function over refs, like `tsvectorOf`.

## Ownership and drift

- **UQL diffs only what it owns**, named `_uql`, so a hand-written trigger is never offered for dropping. It warns about one on a table it keeps an aggregate from: a second writer.
- **It compares names.** The name ends in a hash of the trigger's rendered SQL, django-pgtrigger's idea moved from a Postgres-only `COMMENT` into the one place every engine keeps: a trigger is in place exactly when its name is installed, so an unchanged one emits nothing and a drift check stays empty, and an edited one is a new name, created while the old drops as undeclared. Nothing is ever created where it exists, so no engine needs `CREATE OR REPLACE TRIGGER`. A generated migration's `down` drops what it created and restores what it dropped, read off the catalogue when the migration is written.
- **Dropping one drops its function** on the Postgres family, which a `DROP TRIGGER` leaves behind.
- **A retyped or dropped column takes the table's triggers off around the alter.** Postgres refuses to change a column a trigger's `UPDATE OF` or `WHEN` names, and the hash cannot see a type change, so every trigger on a table whose columns change is dropped before the alters and the declared ones created after.
- **`sync` creates them too**, so test databases match production. PGlite runs PL/pgSQL, so in-process tests exercise real ones.
- **Storing is two steps:** the column and triggers commit together, then a backfill outside the migration's transaction (`transaction: false`) locks each parent `FOR UPDATE` and recounts it, which is exact under READ COMMITTED. Unstoring drops both.
- **`aggregate:check`** compares each stored value with its recount, and `--repair` fixes it: the answer to what no row trigger sees, such as `TRUNCATE` or `session_replication_role = replica`.

## What it rests on: nothing

This design was written expecting to need [R7 and R7b](roadmap.md) - a flattened `SchemaDiffResult`, and a record of what uql rendered so a changed body could be told from an unchanged one. It needed neither, and
the `uql_schema_objects` table it proposed was designed and dropped three times before the reason was clear enough to write down:

- **A trigger is never diffed.** Its name carries a hash of its SQL, so comparing installed names against declared ones is the whole comparison, and there is no fingerprint to store.
- **Ownership is the name.** Everything uql installs is `_uql`-prefixed and carries its table, so the catalogue says which triggers are uql's without any record of its own.
- **The engine already keeps the render.** `pg_get_triggerdef`, `sqlite_master.sql`, `information_schema.TRIGGERS` and `sys.sql_modules` each hand back what is installed, which is what a rollback puts back. The engine's reprint is useless for _detecting_ a change and exactly right for _restoring_ one, and that distinction is what made a side table look necessary for so long.

## What shipped

One renderer, every difference between engines declared in `features.triggers` rather than branched on a dialect name: where the body lives, how a guard is stated, whether it fires per row or per statement,
whether it may assign to the row it was handed, whether it has a `BEFORE`, where its name is unique, what its body opens with (T-SQL's `SET NOCOUNT ON`), and the two T-SQL spells differently. A seventh engine states its shape and renders unchanged.

Proven against real databases on all six: Postgres, CockroachDB, MySQL, MariaDB, SQLite and SQL Server, in one suite, plus PGlite in process.

Three engine truths only a database would have told us, each of which broke a plausible design:

- **CockroachDB has no usable `WHEN`** - it resolves neither `OLD` nor `NEW` - and no `UPDATE OF`, so its guard goes in the body like the MySQL family's.
- **The MySQL family refuses a trigger that updates the table it fires on**, which is why the cross-engine suite writes to a second table.
- **SQL Server hands the body `inserted` and `deleted` as tables**, not records, so a comparison cannot read one row directly: `of` is answered by `EXISTS (SELECT ... EXCEPT SELECT ...)` over a join between them - null-safe, and comparing values rather than asking `UPDATE(col)`, which fires on a column merely assigned. `where` is refused there outright, since no condition can be written against a set. The join is on the key, the only pairing SQL Server offers, so a statement changing a row's key leaves that row unpaired: its guard and its writes see nothing. Pairing a single-row statement regardless would need an `OR` in the join, a nested loop over every bulk update.

## What is left

- The maintained aggregate, if ever: a column, a function, three triggers per child, a backfill outside the migration's transaction, and `aggregate:check --repair` for when it drifts.
- Schema-scoped objects - extensions, functions, domains - which have a caller already: Variability hand-rolls them as a `databasePrerequisites` array replayed in three places and written a fourth time inside a migration, where nothing keeps the copies in step. A declarable function is also what lets an expression index over one move onto the entity.
- Runtime bypass and deferrable execution, both of which django-pgtrigger has and this does not.

## Not in this design

- **Stored `min`/`max`**, a different cost model.
- **Aggregates through a chain of relations.** A grandchild's insert never touches the child's row.
- **Reading a stored aggregate for `$count` or `$sort` automatically.** A query's result would then depend on a column declared elsewhere, and on whether it had drifted. Selecting the field is how you ask for it.
- **A hot parent** serializes its children's writers. Statement-level bodies over transition tables (a flag, not a redesign) and sharded counters are the fixes.

## MongoDB

The server runs no trigger. Atlas Database Triggers exist, and none of them can back `@Trigger`:

- **They fire after the commit,** from a change stream read by Atlas's serverless compute, outside the write's transaction. No `before` event, no `where` that holds the row back, no `run` that rolls back with it, and a stamp would be a second write landing later.
- **Delivery is not guaranteed.** A trigger suspends on a dropped or renamed collection, a network loss or an oplog that rolled past its resume token, and auto-resume skips what it missed.
- **Atlas only,** declared through its UI or Admin API with project credentials rather than over the connection `sync` holds, and absent from Community and self-managed servers.
- **The body is a JavaScript function,** and `$old` needs collection pre-images turned on.

Emulating one in uql's own writes would cover only uql's writes, where a trigger's point is to fire whoever writes the row. So a write to such an entity is refused rather than made without it.

## Why

Variability's production database kept 20 counters with hand-written triggers. Only two had a reader, both sizing a loading skeleton, and the triggers carried every bug: a trigger naming a missing column that aborted every search insert for months, counters never written, no update branch for reparenting, and a repair migration that overwrote one counter with another. It now reads the two it needs as unstored aggregates.

Elsewhere, a census of unrelated codebases found only `updated_at` stamps and one `NOTIFY`, which is why stamps and authored triggers are here. The tools that manage triggers author and diff them but build no aggregate on one; the frameworks that maintain counters do it in the application and ship a repair command for when it drifts. Nothing offers a maintained aggregate that starts life as an ordinary read.
