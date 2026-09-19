# Triggers

What `stored` adds beyond the generated column: an aggregate the database keeps, a stamp the database writes, and a trigger you author. The unstored relation aggregate shipped in 0.69.0; everything here needs [R7](roadmap.md) and ships on Postgres first, then a renderer per SQL engine. MongoDB has no triggers, so it refuses `stored` and keeps reading every aggregate unstored.

## One dial

`computed` says what the database derives, `stored` when it recomputes, and together they pick the machinery.

```ts
@Field({ type: String, computed: (u) => raw`${u.first} || ' ' || ${u.last}`, stored: true }) readonly fullName?: string;
@Field({ computed: (u) => u.resources.count() })                                              readonly resourceCount?: number;
@Field({ computed: (u) => u.resources.count(), stored: true })                                readonly resourceCount?: number;
@Field({ type: Date, computed: raw`now()`, stored: ['update'] })                              readonly updatedAt?: Date;
```

| `stored`               | SQL expression                                                       | Relation aggregate             |
| :--------------------- | :------------------------------------------------------------------- | :----------------------------- |
| `false`, the default   | spliced into each statement                                          | read in the parent's statement |
| `true`                 | `GENERATED ALWAYS AS (...) STORED`                                   | kept by triggers on the child  |
| `['insert', 'update']` | a `BEFORE` trigger; the MySQL family's `ON UPDATE CURRENT_TIMESTAMP` | refused                        |

- **Flipping `stored` edits no call site.** Every clause reads the field the same way and its type does not move. Start unstored; store what profiling names.
- **An event list is what selects a stamp.** `GENERATED ALWAYS AS (now())` is rejected as not immutable, and UQL cannot tell whether a `raw` is.
- **The types are in place.** `stored: true` compiles only on a `count` or `sum` with no page, the property must equal the aggregate's value, and a write refuses a `readonly` field. What remains is `stored` taking an event list on a column.

## The maintained aggregate

UQL generates the column (`bigint NOT NULL DEFAULT 0` for a count, the field's type for a sum), the function and its triggers, the backfill, and the check that finds drift. It loads only where a query names it, stored or not.

**Only `count` and `sum` store**, since only they turn a row change into a delta: `+1`/`-1`, `+x`/`-x`. A `min` or `max` must rescan when the extreme is deleted, and an `avg` is two columns. A lifetime tally, deleted rows included, is not an aggregate: count a soft-deleting table through `withDeleted` instead.

**The body is the predicate, differentiated.** An insert adds where `NEW` matches, a delete subtracts where `OLD` matches, and an update applies `(NEW matches) - (OLD matches)` to both parents. That one update branch covers reparenting, filtering in and out, and soft delete, which is the branch every hand-written counter forgets. Each side is `coalesce(pred, false)`, since a predicate can be `NULL`.

**The child's default-on filters are part of the predicate**, soft delete included, so the stored column agrees with the unstored one.

**One function and three single-event triggers per child** (`afterInsert`, `afterDelete`, and `afterUpdate` with `changed` set to the keys and predicate columns): the machinery an authored trigger uses. The function is `SECURITY DEFINER` with `search_path` pinned, so a writer allowed the child but not the parent, or row-level security on the parent, cannot fail every insert. It is a plain `AFTER` trigger, not a deferred constraint trigger: deferral only shortens the parent's lock.

**On each engine**, the body is rows of `(parent, key, delta, predicate)` rendered as `UPDATE`s. SQLite, MySQL and MariaDB take row triggers; SQL Server takes the set-based `inserted`/`deleted`; CockroachDB has no `UPDATE OF`, so `changed` becomes the `WHEN` alone.

**Refused:**

- a per-request `security` filter, which no trigger can see;
- an edge whose foreign key cascades on update, which would move the count twice;
- a child that is its own parent on the MySQL family, whose triggers cannot update their own table;
- a filtered many-to-many, until the target gets a second trigger for the columns that flip the filter.

## The database-side stamp

```ts
@Field({ type: Date, computed: raw`now()`, stored: ['update'] }) readonly updatedAt?: Date;
```

`onUpdate` stamps only UQL's own writes; an event list makes the database the one writer, so a raw `UPDATE` or a second service stamps too. Postgres takes a `BEFORE` trigger, and the MySQL family its native `ON UPDATE CURRENT_TIMESTAMP` where the stamp is the clock. The next read returns it, as for a generated column.

## The authored trigger

The escape hatch, built last.

```ts
const tsvectorOf = (row: RefMap<Post>) => raw`${row.searchVector} := to_tsvector('english', ${row.body});`;

@Entity({
  triggers: {
    beforeInsert: { run: tsvectorOf },
    beforeUpdate: { changed: (post) => [post.body], run: tsvectorOf },
    afterUpdate: { changed: (post) => [post.status], run: (row) => raw`PERFORM pg_notify('post_status', ${row.id}::text);` },
  },
})
```

- **Keyed by the hook event names.** No upsert key: `ON CONFLICT` fires the insert or update triggers. A key takes one trigger or a list, fired in order.
- **The event types `run`'s parameters:** `(row)` on insert, `(row, old)` on update, `(old)` on delete, rendering `NEW."col"` and `OLD."col"`. Reading `old` on an insert does not compile.
- **`changed`, on update only,** emits `UPDATE OF` plus `WHEN (OLD.c IS DISTINCT FROM NEW.c ...)`. **`when`** is an `EntityPredicate<E>` or a SQL callback.
- **`run` is raw SQL** for its engine; the generator adds the function wrapper and `RETURN NEW`/`NULL`. Reuse is a plain function over refs, like `tsvectorOf`.

## Ownership and drift

- **UQL diffs only what it owns**, named `_uql`, so a hand-written trigger is never offered for dropping. It warns about one on a table it keeps an aggregate from: a second writer.
- **It compares what it rendered**, never the engine's reprint: a Postgres function carries its body's hash in `COMMENT ON FUNCTION`; SQLite keeps the text verbatim. A body change is `CREATE OR REPLACE FUNCTION`, which locks no table.
- **`sync` creates them too**, so test databases match production. PGlite runs PL/pgSQL, so in-process tests exercise real ones.
- **Storing is two steps:** the column and triggers commit together, then a backfill outside the migration's transaction (`transaction: false`) locks each parent `FOR UPDATE` and recounts it, which is exact under READ COMMITTED. Unstoring drops both.
- **`aggregate:check`** compares each stored value with its recount, and `--repair` fixes it: the answer to what no row trigger sees, such as `TRUNCATE` or `session_replication_role = replica`.

## Build order

After R7, on Postgres: stored aggregates, then stamps, then authored triggers. Still missing:

- a `pg_trigger`/`pg_proc` introspector;
- row-qualified refs (`row`/`old`) in `compileDdl`;
- trigger-backed rows in `FIELD_OPTION_FAMILY`, since `computed` now kills `defaultValue`, which a stored aggregate needs;
- an integration suite on Postgres and PGlite: insert, delete, reparent, a filter flip, soft delete, a backfill racing writes, and `aggregate:check` after `TRUNCATE`.

Then a renderer per engine.

## Not in this design

- **Stored `min`/`max`**, a different cost model.
- **Aggregates through a chain of relations.** A grandchild's insert never touches the child's row.
- **Reading a stored aggregate for `$count` or `$sort` automatically.** A query's result would then depend on a column declared elsewhere, and on whether it had drifted. Selecting the field is how you ask for it.
- **A hot parent** serializes its children's writers. Statement-level bodies over transition tables (a flag, not a redesign) and sharded counters are the fixes.

## Why

Variability's production database kept 20 counters with hand-written triggers. Only two had a reader, both sizing a loading skeleton, and the triggers carried every bug: a trigger naming a missing column that aborted every search insert for months, counters never written, no update branch for reparenting, and a repair migration that overwrote one counter with another. It now reads the two it needs as unstored aggregates.

Elsewhere, a census of unrelated codebases found only `updated_at` stamps and one `NOTIFY`, which is why stamps and authored triggers are here. The tools that manage triggers author and diff them but build no aggregate on one; the frameworks that maintain counters do it in the application and ship a repair command for when it drifts. Nothing offers a maintained aggregate that starts life as an ordinary read.
