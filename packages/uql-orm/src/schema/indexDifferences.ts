import type { IndexColumnSchema } from '../type/index.js';
import type { IndexNode } from './types.js';

/**
 * What an introspector can report about an index, and so all that diffing may compare. Anything it
 * cannot report is skipped: the entity declares it, the database never mentions it, and no migration
 * could ever make the two agree.
 *
 * Deliberately separate from the dialect's `IndexFeature`, which says what an engine can *emit* and
 * rejects outright. The two look alike and are not: Postgres emits an expression index and reads one
 * back, MySQL emits one it cannot describe afterwards.
 */
export type IndexFacet = 'order' | 'nulls' | 'opsClass' | 'accessMethod' | 'include';

/**
 * Whether the table already has this index, for the additive sync that only ever *creates* one.
 *
 * Its shape, never its name: the table's indexes were named by whoever created them, so an index
 * that is already there must not be created a second time under a name we happen to prefer. A
 * derived name is no handle at all - the convention can change, an engine silently truncates one
 * past its identifier limit, and SQLite reports names it made up.
 *
 * Uniqueness counts, because a unique index and a plain one over the same columns enforce different
 * things and no engine can alter one into the other. An index over an expression or a JSON path has
 * no comparable columns - engines reprint SQL text from their parse tree, the same reason
 * {@link describeIndexDifferences} leaves those entries alone - so it falls back to its name.
 */
export function indexSignature(index: Pick<IndexNode, 'name' | 'entries' | 'unique'>): string {
  const comparable = !index.entries.some((entry) => entry.expression || entry.jsonPath || entry.jsonArray);
  const identity = comparable
    ? index.entries.map((entry) => entry.column).join(',')
    : `name:${indexNameStem(index.name)}`;
  return `${index.unique ? 'unique' : 'plain'}(${identity})`;
}

/**
 * A constraint name without its kind marker.
 *
 * What pairs two sides of a *report*: an index whose uniqueness or columns changed is one index that
 * differs, not one dropped and another created, and only a handle independent of its shape can say
 * so. Stripping the marker is what lets `idx_User_email`, named before the convention moved it to
 * the end, recognise the `User__email_idx` derived for it now, so upgrading reports no drift.
 *
 * Exactly one marker, and the trailing one first. Stripping both ends would eat a leading marker
 * that belongs to the *table* - an index over `pk_registry` is not a primary key - leaving it unable
 * to pair with its own older name. The separator is levelled last, since only one convention doubles
 * it.
 */
export function indexNameStem(name: string): string {
  const withoutSuffix = name.replace(KIND_SUFFIX, '');
  const bare = withoutSuffix === name ? name.replace(KIND_PREFIX, '') : withoutSuffix;
  return bare.replace(/__/g, '_');
}

/** What this version emits. */
const KIND_SUFFIX = /_(?:idx|fk|ck|pk|uk|uq)$/i;

/**
 * What it only ever *reads*: uql wrote `idx_User_email` until 0.42.1, and a database it did not
 * create at all - the one `generate:from-db` points at - most often spells it that way too. Tried
 * second, so a name already marked at the end keeps a leading `pk_` that is part of its table.
 */
const KIND_PREFIX = /^(?:idx|fk|ck|pk|uk|uq)_/i;

/**
 * Everything an index differs by, named, or nothing when the two match.
 *
 * Only what both sides can state *structurally* is compared. SQL text is not: a database reprints an
 * expression and a predicate from its parse tree, so `status IN ('a','b')` reads back as
 * `status = ANY (ARRAY['a'::text, 'b'::text])`, `LIKE` as `~~`, and a date literal with its time zone
 * spelled out. Folding that back needs a SQL parser, and every near-miss reports drift that no
 * migration can settle. So a partial index's predicate is never compared, and an index over an
 * expression - a `raw()` one, or a JSON path, which the engines report as an expression too - has
 * its entries left alone while the rest of it still compares.
 */
export function describeIndexDifferences(
  source: IndexNode,
  target: IndexNode,
  facets: ReadonlySet<IndexFacet>,
): string[] {
  const differences: string[] = [];
  const comparableEntries = ![...source.entries, ...target.entries].some(
    (entry) => entry.expression || entry.jsonPath || entry.jsonArray,
  );

  if (comparableEntries) {
    const [sourceColumns, targetColumns] = [source.entries, target.entries].map((entries) =>
      entries.map((entry) => entrySignature(entry, facets)).join(', '),
    );
    if (sourceColumns !== targetColumns) {
      differences.push(`columns: (${targetColumns}) → (${sourceColumns})`);
    }
  }

  if ((source.unique ?? false) !== (target.unique ?? false)) {
    differences.push(`unique: ${target.unique ?? false} → ${source.unique ?? false}`);
  }

  if (facets.has('accessMethod') && (source.type ?? 'btree') !== (target.type ?? 'btree')) {
    differences.push(`type: ${target.type ?? 'btree'} → ${source.type ?? 'btree'}`);
  }

  if (facets.has('include')) {
    // Order carries no meaning in an `INCLUDE` list, so it is compared as a set.
    const [sourceInclude, targetInclude] = [source.include ?? [], target.include ?? []].map((columns) =>
      [...columns].sort().join(', '),
    );
    if (sourceInclude !== targetInclude) {
      differences.push(`include: (${targetInclude}) → (${sourceInclude})`);
    }
  }

  return differences;
}

function entrySignature(entry: IndexColumnSchema, facets: ReadonlySet<IndexFacet>): string {
  const parts = [entry.column];
  if (facets.has('order')) {
    parts.push(entry.order ?? 'asc');
  }
  if (facets.has('nulls')) {
    // Postgres states this on every entry, so an entity that omits it has asked for Postgres's own
    // default: nulls sort opposite to the direction.
    parts.push(`nulls ${entry.nulls ?? ((entry.order ?? 'asc') === 'desc' ? 'first' : 'last')}`);
  }
  if (facets.has('opsClass') && entry.opsClass) {
    parts.push(entry.opsClass);
  }
  return parts.join(' ');
}
