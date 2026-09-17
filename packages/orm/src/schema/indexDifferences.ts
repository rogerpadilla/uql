import type { IndexColumnSchema } from '../type/index.js';
import type { IndexNode } from './types.js';

/** What an introspector reports about an index, and so all a diff may compare; apart from `IndexFeature`, what an engine emits. */
export type IndexFacet = 'order' | 'nulls' | 'opsClass' | 'accessMethod' | 'include';

/**
 * Whether the table has this index already, by shape rather than name, uniqueness included. An index
 * over an expression, whose text the engine reprints, falls back to its name.
 */
export function indexSignature(index: Pick<IndexNode, 'name' | 'entries' | 'unique'>): string {
  const comparable = !index.entries.some((entry) => entry.expression || entry.jsonPath || entry.jsonArray);
  const identity = comparable
    ? index.entries.map((entry) => entry.column).join(',')
    : `name:${indexNameStem(index.name)}`;
  return `${index.unique ? 'unique' : 'plain'}(${identity})`;
}

/**
 * A constraint name without its kind marker, pairing an index with its older spelling
 * (`idx_User_email` with `User__email_idx`). Only one marker, the trailing one first.
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
 * What two indexes differ by, comparing only what both sides state structurally: an expression, a JSON
 * path or a predicate is reprinted by the engine, so never compared.
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
      differences.push(`columns: (${targetColumns}) -> (${sourceColumns})`);
    }
  }

  if (source.unique !== target.unique) {
    differences.push(`unique: ${target.unique} -> ${source.unique}`);
  }

  if (facets.has('accessMethod') && (source.type ?? 'btree') !== (target.type ?? 'btree')) {
    differences.push(`type: ${target.type ?? 'btree'} -> ${source.type ?? 'btree'}`);
  }

  if (facets.has('include')) {
    // Order carries no meaning in an `INCLUDE` list, so it is compared as a set.
    const [sourceInclude, targetInclude] = [source.include ?? [], target.include ?? []].map((columns) =>
      [...columns].sort().join(', '),
    );
    if (sourceInclude !== targetInclude) {
      differences.push(`include: (${targetInclude}) -> (${sourceInclude})`);
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
