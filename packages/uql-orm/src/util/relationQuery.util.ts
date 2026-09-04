import type {
  EntityMeta,
  Except,
  Query,
  QueryPopulate,
  QuerySelect,
  RelationKey,
  RelationMeta,
} from '../type/index.js';
import {
  QUERY_BOOLEAN_CLAUSES,
  QUERY_NUMBER_CLAUSES,
  QUERY_OBJECT_CLAUSES,
  QUERY_ROOT_NUMBER_CLAUSES,
} from '../type/query.js';
import { getKeys, someKey } from './object.util.js';

export type RelationRequestSummary<E> = {
  readonly requestedKeys: RelationKey<E>[];
  readonly joinableKeys: RelationKey<E>[];
  readonly toManyKeys: RelationKey<E>[];
};

/**
 * Whether a relation holds many rows per parent, so it cannot be joined into the parent's row. Takes
 * the one field it reads, so it answers for a relation being declared as well as for a resolved one.
 */
export function isToManyRelation(relation: Pick<RelationMeta, 'cardinality'>): boolean {
  return relation.cardinality === '1m' || relation.cardinality === 'mm';
}

/**
 * The column holding the parent's id: a junction's own for a relation that goes through one, the
 * child's foreign key otherwise. The two are spelled from opposite ends - `local` names a column of
 * the table the relation is declared to write, `foreign` a column of the other one - and getting
 * that backwards reads a real column of the wrong table, so it is answered once here.
 */
export function parentKeyColumn(relOpts: Pick<RelationMeta, 'references' | 'through'>): string {
  return relOpts.through ? relOpts.references[0].local : relOpts.references[0].foreign;
}

/** The column on a junction table holding the target's id, the other half of {@link parentKeyColumn}. */
export function targetKeyColumn(relOpts: Pick<RelationMeta, 'references'>): string {
  return relOpts.references[1].local;
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
  const requestedKeys: RelationKey<E>[] = [];
  const joinableKeys: RelationKey<E>[] = [];
  const toManyKeys: RelationKey<E>[] = [];

  if (!populate) return { requestedKeys, joinableKeys, toManyKeys };

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

// `$lock` and `$candidates` are statement-level, so they are not part of a relation query:
// `parseRelationQueryValue` rejects them explicitly rather than letting one fall through as an
// unrecognized shape.
export type RelationQuery<E extends object = object> = Except<Query<E>, StatementOnlyClause> & {
  $required?: boolean;
};

/** The clauses that describe the statement rather than what a query selects. */
type StatementOnlyClause = '$lock' | '$candidates';

/** Their runtime half, so the check below cannot drift from the type above. */
const STATEMENT_ONLY_CLAUSES: readonly StatementOnlyClause[] = ['$lock', ...QUERY_ROOT_NUMBER_CLAUSES];

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
    const statementOnly = STATEMENT_ONLY_CLAUSES.find((clause) => clause in value);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
    if (RELATION_QUERY_OBJECT_KEYS.has(key) && !isRecord(value)) {
      return false;
    }
    if (RELATION_QUERY_NUMBER_KEYS.has(key) && (typeof value !== 'number' || !Number.isFinite(value))) {
      return false;
    }
  }
  return hasKnownKey;
}
