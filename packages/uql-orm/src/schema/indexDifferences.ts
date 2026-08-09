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
 * Everything an index differs by, named, or nothing when the two match.
 *
 * Only what both sides can state *structurally* is compared. SQL text is not: a database reprints an
 * expression and a predicate from its parse tree, so `status IN ('a','b')` reads back as
 * `status = ANY (ARRAY['a'::text, 'b'::text])`, `LIKE` as `~~`, and a date literal with its time zone
 * spelled out. Folding that back needs a SQL parser, and every near-miss reports drift that no
 * migration can settle. So a partial index's predicate is never compared, and an index over an
 * expression has its entries left alone while the rest of it still compares.
 */
export function describeIndexDifferences(
  source: IndexNode,
  target: IndexNode,
  facets: ReadonlySet<IndexFacet>,
): string[] {
  const differences: string[] = [];
  const comparableEntries = ![...source.entries, ...target.entries].some((entry) => entry.expression);

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
