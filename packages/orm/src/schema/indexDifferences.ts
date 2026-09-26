import type { IndexColumnSchema, IndexSchema } from '../type/index.js';
import { indexDistance, isVectorIndexType } from '../type/vector.js';
import { fulltextConfig } from '../util/dialect.util.js';
import { derivedIndexName } from '../util/sql.util.js';
import { matchByKey } from './matchByKey.js';
import type { IndexNode } from './types.js';

/**
 * What an introspector reports about an index, and so all a diff may compare; apart from `IndexFeature`, what an engine emits.
 * `vector` is whether it is a vector index at all, for an engine with one vector index whatever type declared it;
 * `distance` is the metric a vector index was built for.
 * `textIndex` is a text index's weights and language, kept by an engine that lists its fields in no declared order.
 */
export type IndexFacet =
  | 'order'
  | 'nulls'
  | 'opsClass'
  | 'accessMethod'
  | 'include'
  | 'vector'
  | 'distance'
  | 'textIndex';

type ComparableIndex = Pick<IndexNode, 'name' | 'entries' | 'unique'>;

/** An entry the engine reprints in its own words, so never compared as written. */
function isReprinted(entry: IndexColumnSchema): boolean {
  return Boolean(entry.expression || entry.jsonPath || entry.jsonArray);
}

/**
 * Whether the table has this index already, by shape rather than name, uniqueness included. An index
 * over an expression, whose text the engine reprints, falls back to its name.
 */
export function indexSignature(index: ComparableIndex): string {
  const comparable = !index.entries.some(isReprinted);
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

/**
 * Pairs by name, then what is left by shape: an index the database has under another name is still
 * the one asked for. What stays unpaired is created or dropped.
 */
export function pairIndexes<S extends ComparableIndex, T extends ComparableIndex>(
  source: readonly S[],
  target: readonly T[],
  normalizeName: (name: string) => string = (name) => name,
) {
  const byName = matchByKey(source, target, (index) => normalizeName(indexNameStem(index.name)));
  const byShape = matchByKey(byName.created, byName.dropped, indexSignature);
  return { created: byShape.created, dropped: byShape.dropped, matched: [...byName.matched, ...byShape.matched] };
}

/**
 * The indexes a table lacks, the ones it no longer needs, and the ones to rebuild, differing in what
 * `facets` let the engine report. Only an unpaired index uql named, or whose name the entity claims, is
 * dropped: any other may have been made outside the ORM, so it is `kept`.
 */
export function indexChanges<I extends IndexSchema>(
  table: string,
  declared: readonly I[],
  current: readonly IndexNode[],
  facets: ReadonlySet<IndexFacet>,
): { toAdd: I[]; toDrop: IndexNode[]; toAlter: { from: IndexNode; to: I }[]; kept: IndexNode[] } {
  const { created, dropped, matched } = pairIndexes(declared, current);
  const claimed = new Set(declared.map((index) => index.name));
  const owned = (index: IndexNode) => claimed.has(index.name) || hasDerivedName(table, index);
  return {
    toAdd: created,
    toDrop: dropped.filter(owned),
    kept: dropped.filter((index) => !owned(index)),
    toAlter: matched.flatMap(([to, from]) => (describeIndexDifferences(to, from, facets).length ? [{ from, to }] : [])),
  };
}

/**
 * Whether uql named the index itself, from its own columns: `Order__total_idx`, its unique `_uk`, or
 * the `idx_Order_total` it wrote until 0.42.1.
 */
function hasDerivedName(table: string, index: ComparableIndex): boolean {
  const parts = index.entries.map((entry, at) => (isReprinted(entry) ? `expr${at}` : entry.column));
  const derived = [
    derivedIndexName(table, parts),
    derivedIndexName(table, parts, true),
    `idx_${table}_${parts.join('_')}`,
  ];
  return derived.includes(index.name);
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
  source: IndexSchema,
  target: IndexSchema,
  facets: ReadonlySet<IndexFacet>,
): string[] {
  const differences: string[] = [];
  const comparableEntries = ![...source.entries, ...target.entries].some(isReprinted);

  if (comparableEntries) {
    const [sourceColumns, targetColumns] = [source, target].map((index) =>
      textFieldOrder(
        index,
        facets,
        index.entries.map((entry) => entrySignature(entry, facets)),
      ).join(', '),
    );
    if (sourceColumns !== targetColumns) {
      differences.push(`columns: (${targetColumns}) -> (${sourceColumns})`);
    }
  }

  if (facets.has('textIndex') && source.type === 'fulltext' && target.type === 'fulltext') {
    const [expected, actual] = [fulltextConfig(source), fulltextConfig(target)];
    if (expected !== actual) {
      differences.push(`config: ${actual} -> ${expected}`);
    }
  }

  if (source.unique !== target.unique) {
    differences.push(`unique: ${target.unique} -> ${source.unique}`);
  }

  if (facets.has('accessMethod') && (source.type ?? 'btree') !== (target.type ?? 'btree')) {
    differences.push(`type: ${target.type ?? 'btree'} -> ${source.type ?? 'btree'}`);
  }

  const bothVector = isVectorIndexType(source.type) && isVectorIndexType(target.type);
  if (facets.has('distance') && bothVector && indexDistance(source) !== indexDistance(target)) {
    differences.push(`distance: ${indexDistance(target)} -> ${indexDistance(source)}`);
  }

  if (facets.has('vector') && isVectorIndexType(source.type) !== isVectorIndexType(target.type)) {
    const [expected, actual] = [source, target].map((index) => (isVectorIndexType(index.type) ? 'yes' : 'no'));
    differences.push(`vector index: ${actual} -> ${expected}`);
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

/** A text index's fields as a set where the engine keeps its weights: MongoDB lists them alphabetically. */
function textFieldOrder(index: Pick<IndexNode, 'type'>, facets: ReadonlySet<IndexFacet>, entries: string[]): string[] {
  return facets.has('textIndex') && index.type === 'fulltext' ? entries.toSorted() : entries;
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
  if (facets.has('textIndex') && (entry.weight ?? 1) !== 1) {
    parts.push(`weight ${entry.weight}`);
  }
  return parts.join(' ');
}
