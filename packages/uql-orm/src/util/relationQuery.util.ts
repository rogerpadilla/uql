import type {
  EntityMeta,
  QueryCount,
  QueryPopulate,
  QuerySelect,
  RelationKey,
  RelationMeta,
  RelationQuery,
  QueryWhere,
} from '../type/index.js';
import {
  QUERY_BOOLEAN_CLAUSES,
  QUERY_NUMBER_CLAUSES,
  QUERY_OBJECT_CLAUSES,
  QUERY_STATEMENT_CLAUSES,
} from '../type/query.js';
import { getKeys, isRecord, someKey } from './object.util.js';

export type RelationRequestSummary<E> = {
  readonly requestedKeys: readonly RelationKey<E>[];
  readonly joinableKeys: readonly RelationKey<E>[];
  readonly toManyKeys: readonly RelationKey<E>[];
};

/** What a query populating nothing requests, shared: most reads populate nothing, and ask on every one. */
const NOTHING_REQUESTED: RelationRequestSummary<never> = Object.freeze({
  requestedKeys: Object.freeze([]),
  joinableKeys: Object.freeze([]),
  toManyKeys: Object.freeze([]),
});

/**
 * Whether a relation holds many rows per parent, so it cannot be joined into the parent's row. Takes
 * the one field it reads, so it answers for a relation being declared as well as for a resolved one.
 */
export function isToManyRelation(relation: Pick<RelationMeta, 'cardinality'>): boolean {
  return relation.cardinality === '1m' || relation.cardinality === 'mm';
}

/** One column of a parent's key, paired with the column matching it on the table being joined. */
export type ParentJoin = { readonly parent: string; readonly joined: string };

/**
 * How a relation joins to its parent: `parent` is a column of the parent's own table, `joined` the
 * column matching it on the table the relation reads - a junction's own column for a relation that
 * goes through one, the child's foreign key otherwise.
 *
 * The two are spelled from opposite ends of `references` (`local` names a column of the table the
 * relation is declared on, `foreign` a column of the other one), and getting that backwards reads a
 * real column of the wrong table, so it is answered once here. One pair per key of the parent.
 */
export function parentJoins(
  relOpts: Pick<RelationMeta, 'references' | 'through'>,
  parentKeyCount: number,
): ParentJoin[] {
  if (!relOpts.through) {
    return relOpts.references.map(({ local, foreign }) => ({ parent: local, joined: foreign }));
  }
  // A junction's pairs are the parent's followed by the target's, and how many the parent has is
  // something its caller already knows - so the boundary is passed rather than stored on a relation.
  return relOpts.references.slice(0, parentKeyCount).map(({ local, foreign }) => ({ parent: foreign, joined: local }));
}

/**
 * The junction columns holding the target's key, the other half of {@link parentJoins}.
 *
 * `parentKeyCount` is required: the target's columns start after the parent's, so guessing the
 * boundary returned the parent's *second* column as the target's - a real column of the wrong side,
 * which is the mistake this module exists to prevent.
 */
export function targetKeyColumns(relOpts: Pick<RelationMeta, 'references'>, parentKeyCount: number): string[] {
  return relOpts.references.slice(parentKeyCount).map(({ local }) => local);
}

/**
 * The `$where` naming exactly the children of the rows `parentIds` identifies: an `IN` over the one
 * column a single key contributes, an OR of whole key maps for several - lists of each column apart
 * would pair values no parent has, and a delete would take a child of a parent that survives.
 */
export function childrenOf(joins: readonly ParentJoin[], parentIds: readonly unknown[]): Record<string, unknown> {
  const [first] = joins;
  if (joins.length === 1) {
    return { [first.joined]: parentIds };
  }
  return {
    $or: parentIds.map((id) => Object.fromEntries(joins.map(({ parent, joined }) => [joined, read(id, parent)]))),
  };
}

function read(row: unknown, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

/**
 * What a joined relation cannot carry, and why. A to-many is loaded by a query of its own, which is
 * what gives these four a meaning there; a to-one is one row of the parent's, so every backend used
 * to drop them without a word. `satisfies` ties each key to {@link RelationQuery}, so renaming one
 * breaks this list at compile time rather than quietly stopping the check.
 */
const JOINED_RELATION_REJECTIONS = [
  ['$sort', 'a join brings one row per parent, so there is nothing to order'],
  ['$limit', 'a join brings one row per parent, so there is nothing to page'],
  ['$skip', 'a join brings one row per parent, so there is nothing to page'],
  ['$distinct', 'it applies to the whole statement, not to one of its joins'],
] as const satisfies readonly (readonly [keyof RelationQuery, string])[];

/** A key only a to-many's own query can carry, and that a joined relation therefore rejects. */
export type JoinedRelationRejectedKey = (typeof JOINED_RELATION_REJECTIONS)[number][0];

const JOINED_RELATION_REJECTED_KEYS: ReadonlyMap<JoinedRelationRejectedKey, string> = new Map(
  JOINED_RELATION_REJECTIONS,
);

function assertJoinableRelationQuery(relKey: string, value: unknown): void {
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, reason] of JOINED_RELATION_REJECTED_KEYS) {
    if (key in value) {
      throw new TypeError(`'${key}' is not supported inside $populate of the to-one relation '${relKey}': ${reason}.`);
    }
  }
}

export function getRelationRequestSummary<E>(
  meta: EntityMeta<E>,
  populate?: QueryPopulate<E>,
): RelationRequestSummary<E> {
  if (!populate) return NOTHING_REQUESTED;

  const requestedKeys: RelationKey<E>[] = [];
  const joinableKeys: RelationKey<E>[] = [];
  const toManyKeys: RelationKey<E>[] = [];

  for (const key of getKeys(populate)) {
    if (!populate[key]) continue;

    const relOpts = meta.relations[key];
    if (!relOpts) continue;

    requestedKeys.push(key);

    if (isToManyRelation(relOpts)) {
      toManyKeys.push(key);
    } else {
      // Validated where the cardinality is decided, so every backend and every nesting level rejects
      // the same shapes - the SQL dialects, MongoDB's lookups, and whatever reads this summary next.
      assertJoinableRelationQuery(key, populate[key]);
      joinableKeys.push(key);
    }
  }

  return { requestedKeys, joinableKeys, toManyKeys };
}

/** True when `$populate` includes at least one relation key. */
export function populatesRelations<E>(meta: EntityMeta<E>, populate?: QueryPopulate<E>): boolean {
  if (!populate) return false;
  return someKey(populate, (key) => !!populate[key] && key in meta.relations);
}

/**
 * Each relation a `$count` tallies, and the filter narrowing what it counts: the target's, whose type
 * only the metadata knows this far down, as for a relation filter reaching the same subquery.
 */
export function countedRelations<E>(
  meta: EntityMeta<E>,
  counts: QueryCount<E> | undefined,
): { readonly relKey: RelationKey<E>; readonly relation: RelationMeta; readonly where: QueryWhere<unknown> }[] {
  if (!counts) {
    return [];
  }
  return getKeys(counts).flatMap((relKey) => {
    const count = counts[relKey];
    const relation = meta.relations[relKey];
    if (!count || !relation) {
      return [];
    }
    const where = typeof count === 'object' ? count.$where : undefined;
    return [{ relKey, relation, where: where ?? {} }];
  });
}

// Taken from the clause groups declared beside `Query` itself, so a renamed clause fails to compile
// here instead of quietly narrowing what a relation query accepts. `$required` is the one key that
// is not a `Query` clause at all - it says how the relation joins, not what it selects.
const RELATION_QUERY_BOOLEAN_KEYS = new Set<string>([...QUERY_BOOLEAN_CLAUSES, '$required']);
const RELATION_QUERY_OBJECT_KEYS = new Set<string>(QUERY_OBJECT_CLAUSES);
const RELATION_QUERY_NUMBER_KEYS = new Set<string>(QUERY_NUMBER_CLAUSES);
const RELATION_QUERY_ALLOWED_KEYS = new Set<string>([
  ...RELATION_QUERY_BOOLEAN_KEYS,
  ...RELATION_QUERY_OBJECT_KEYS,
  ...RELATION_QUERY_NUMBER_KEYS,
]);

function isRelationQueryObject<E extends object = object>(value: unknown): value is RelationQuery<E> {
  return isRecord(value) && isValidRelationQueryShape(value);
}

export type ParsedRelationQuery<E extends object = object> = {
  query: RelationQuery<E>;
  required: boolean;
  /** Structured relation query object (recurse validation / nested semantics). */
  nested: boolean;
};

export function parseRelationQueryValue<E extends object = object>(value: unknown): ParsedRelationQuery<E> {
  // Caught before the shape check so the message names the key, rather than reporting the whole
  // object as an unrecognized relation query value.
  if (isRecord(value)) {
    const statementOnly = QUERY_STATEMENT_CLAUSES.find((clause) => clause in value);
    if (statementOnly) {
      throw new TypeError(
        `'${statementOnly}' applies to the whole statement, not to a populated relation. Move it to the top level of the query.`,
      );
    }
  }
  if (isRelationQueryObject(value)) {
    return { query: value, required: value.$required === true, nested: true };
  }
  if (Array.isArray(value)) {
    const selectMap: QuerySelect<E> = {};
    for (const key of value) {
      selectMap[key as keyof QuerySelect<E>] = 1;
    }
    return { query: { $select: selectMap }, required: false, nested: false };
  }
  if (value !== undefined && value !== null && value !== true && value !== 1) {
    throw new TypeError(
      `Invalid relation query value '${String(value)}'. Expected true/1, relation query object, or relation $populate array.`,
    );
  }
  return { query: {} as RelationQuery<E>, required: false, nested: false };
}

/** Parses the relation payload for `relKey` */
export function parseRelationAtKey<E>(relKey: RelationKey<E>, populate?: QueryPopulate<E>): ParsedRelationQuery {
  return parseRelationQueryValue(populate?.[relKey]);
}

export function forEachRequestedRelation<E extends object>(
  meta: EntityMeta<E>,
  populate: QueryPopulate<E> | undefined,
  fn: (relKey: RelationKey<E>, rawValue: unknown) => void,
): void {
  for (const relKey of getRelationRequestSummary(meta, populate).requestedKeys) {
    fn(relKey, populate?.[relKey]);
  }
}

function isBooleanLikeValue(value: unknown): value is boolean | 0 | 1 {
  return value === true || value === false || value === 0 || value === 1;
}

function isValidRelationQueryShape(query: Record<string, unknown>): boolean {
  let hasKnownKey = false;
  for (const [key, value] of Object.entries(query)) {
    if (!RELATION_QUERY_ALLOWED_KEYS.has(key)) {
      return false;
    }
    hasKnownKey = true;
    if (RELATION_QUERY_BOOLEAN_KEYS.has(key) && !isBooleanLikeValue(value)) {
      return false;
    }
    if (RELATION_QUERY_OBJECT_KEYS.has(key) && !isRecord(value) && !(key === '$select' && Array.isArray(value))) {
      return false;
    }
    if (RELATION_QUERY_NUMBER_KEYS.has(key) && (typeof value !== 'number' || !Number.isFinite(value))) {
      return false;
    }
  }
  return hasKnownKey;
}
