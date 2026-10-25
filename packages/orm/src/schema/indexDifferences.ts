import type { IndexEntry, IndexSchema } from '../type/index.js';
import { indexDistance, isVectorIndexType } from '../type/vector.js';
import { declaredIndexName } from '../util/ddlExpression.util.js';
import { fulltextConfig } from '../util/dialect.util.js';
import { indexEntryNamePart, isStored, type StoredEntry, storedColumns } from '../util/indexEntry.util.js';
import { NAME_HASH_LENGTH, TABLE_SEPARATOR } from '../util/sql.util.js';
import { matchByKey } from './matchByKey.js';
import type { IndexNode, TableNode } from './types.js';

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

type ComparableIndex = Pick<IndexNode, 'name' | 'entries' | 'unique' | 'where'>;

/**
 * Whether the table has this index already, by shape rather than name, uniqueness included. An index
 * over an expression, whose text the engine reprints, falls back to its name.
 */
export function indexSignature(index: ComparableIndex): string {
  const identity = storedColumns(index.entries)?.join(',') ?? `name:${indexNameStem(index.name)}`;
  return `${index.unique ? 'unique' : 'plain'}(${identity})`;
}

/**
 * A constraint name without its kind marker, pairing an index with its older spelling
 * (`idx_User_email` with `User__email_idx`). Only one marker, the trailing one first.
 */
export function indexNameStem(name: string): string {
  const withoutSuffix = name.replace(KIND_SUFFIX, '');
  const bare = withoutSuffix === name ? name.replace(KIND_PREFIX, '') : withoutSuffix;
  return bare.replaceAll(TABLE_SEPARATOR, '_');
}

/**
 * Pairs by name, then what is left by shape: an index the database has under another name is still
 * the one asked for. A partial index pairs by name alone, since its predicate is in its name.
 */
export function pairIndexes<S extends ComparableIndex, T extends ComparableIndex>(
  source: readonly S[],
  target: readonly T[],
) {
  const byName = matchByKey(source, target, (index) => indexNameStem(index.name));
  const created = splitPartial(byName.created);
  const dropped = splitPartial(byName.dropped);
  const byShape = matchByKey(created.plain, dropped.plain, indexSignature);
  return {
    created: [...created.partial, ...byShape.created],
    dropped: [...dropped.partial, ...byShape.dropped],
    matched: [...byName.matched, ...byShape.matched],
  };
}

function splitPartial<I extends ComparableIndex>(indexes: readonly I[]) {
  return {
    plain: indexes.filter((index) => index.where === undefined),
    partial: indexes.filter((index) => index.where !== undefined),
  };
}

/** One index change: create (`to`), drop (`from`), or rebuild (both, with a `description` of what differs). */
export type IndexChange<I> =
  | { readonly from?: undefined; readonly to: I }
  | { readonly from: IndexNode; readonly to?: undefined }
  | { readonly from: IndexNode; readonly to: I; readonly description: string };

/** The indexes `current` lacks, every one it has that none declared, and the ones to rebuild, as `facets` see them. */
export function pairedIndexChanges<I extends IndexSchema>(
  declared: readonly I[],
  current: readonly IndexNode[],
  facets: ReadonlySet<IndexFacet>,
): { readonly created: I[]; readonly dropped: IndexNode[]; readonly rebuilt: IndexChange<I>[] } {
  const { created, dropped, matched } = pairIndexes(declared, current);
  const rebuilt = matched.flatMap(([to, from]): IndexChange<I>[] => {
    const differences = describeIndexDifferences(to, from, facets);
    return differences.length ? [{ from, to, description: differences.join(', ') }] : [];
  });
  return { created, dropped, rebuilt };
}

/**
 * {@link pairedIndexChanges} on `table`, dropping only an unpaired index uql named, or whose name the entity
 * claims: any other may have been made outside the ORM, so it is `kept`.
 */
export function indexChanges<I extends IndexSchema>(
  declared: readonly I[],
  table: Pick<TableNode, 'name' | 'indexes' | 'indexFacets'>,
): { changes: IndexChange<I>[]; kept: IndexNode[] } {
  const { created, dropped, rebuilt } = pairedIndexChanges(declared, table.indexes, table.indexFacets);
  const claimed = new Set(declared.map((index) => index.name));
  const isOwned = (index: ComparableIndex) => claimed.has(index.name) || hasDerivedName(table.name, index);
  const { owned = [], kept = [] } = Object.groupBy(dropped, (index) => (isOwned(index) ? 'owned' : 'kept'));
  return {
    changes: [...created.map((to) => ({ to })), ...owned.map((from) => ({ from })), ...rebuilt],
    kept,
  };
}

/**
 * Whether uql named the index itself, from the entries the database reports: the name it would derive for them, with
 * the predicate's hash read off the name and a unique one's `_uk` as the migration builder names it, or as an earlier
 * uql derived it: `expr<n>` for a JSON path, or `idx_<table>_<parts>`.
 */
function hasDerivedName(table: string, index: ComparableIndex): boolean {
  const name = index.where === undefined ? index.name : index.name.replace(PREDICATE_HASH, '');
  const earlier = index.entries.map((entry): IndexEntry<unknown> =>
    entry.json === undefined ? entry : { expression: '' },
  );
  return [index.entries, earlier].some((entries) => {
    const parts = entries.map(indexEntryNamePart);
    return (
      name === declaredIndexName(undefined, table, entries) ||
      (index.unique && name === declaredIndexName(undefined, table, entries, { unique: true })) ||
      name === `idx_${table}_${parts.join('_')}`
    );
  });
}

/** The hash a partial index's derived name carries before its kind. */
const PREDICATE_HASH = new RegExp(`_[0-9a-f]{${NAME_HASH_LENGTH}}(?=_(?:idx|uk)$)`);

/**
 * The kind a name ends in: `pk`, `fk`, `idx` and `uk` are what uql derives, and `ck` and `uq` are read too, though
 * no name it derives ends in them.
 */
const KIND_SUFFIX = /_(?:idx|fk|ck|pk|uk|uq)$/i;

/**
 * What it only ever *reads*: a database an older uql created holds `idx_User_email`, and one it did not
 * create at all - the one `generate:from-db` points at - most often spells it that way too. Tried
 * second, so a name already marked at the end keeps a leading `pk_` that is part of its table.
 */
const KIND_PREFIX = /^(?:idx|fk|ck|pk|uk|uq)_/i;

/**
 * What two indexes differ by, comparing only what both sides state structurally. An expression or a JSON
 * path is reprinted by the engine, so never compared; a predicate only by whether there is one, its text
 * being in an unnamed index's name.
 */
export function describeIndexDifferences(
  source: IndexSchema,
  target: IndexSchema,
  facets: ReadonlySet<IndexFacet>,
): string[] {
  const differences: string[] = [];
  const [sourceColumns, targetColumns] = [source, target].map((index) =>
    isStored(index.entries)
      ? textFieldOrder(
          index,
          facets,
          index.entries.map((entry) => entrySignature(entry, facets)),
        ).join(', ')
      : undefined,
  );
  if (sourceColumns !== undefined && targetColumns !== undefined && sourceColumns !== targetColumns) {
    differences.push(`columns: (${targetColumns}) -> (${sourceColumns})`);
  }

  if (facets.has('textIndex') && source.type === 'fulltext' && target.type === 'fulltext') {
    const [expected, actual] = [fulltextConfig(source), fulltextConfig(target)];
    if (expected !== actual) {
      differences.push(`config: ${actual} -> ${expected}`);
    }
  }

  if ((source.where === undefined) !== (target.where === undefined)) {
    differences.push(`predicate: ${target.where ?? 'none'} -> ${source.where ?? 'none'}`);
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

function entrySignature(entry: StoredEntry<string>, facets: ReadonlySet<IndexFacet>): string {
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
