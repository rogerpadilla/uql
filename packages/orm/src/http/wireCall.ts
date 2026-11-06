import type { AbstractType, EntityAccess, UniversalQuerier } from '../type/index.js';
// the brand, which a `sql` fragment and a column ref both carry
import { SQL_FN } from '../type/querySql.js';
// the specific util modules, not the barrel, which reaches every dialect helper and would land in the browser bundle
import { getKeys, isPlainObject } from '../util/object.util.js';
import { kebabCase } from '../util/string.util.js';
import { UqlUsageError } from '../util/uqlError.js';

/** What an op answers, which says how its values cross JSON: rows, a page of them, rows and their count, keys, or a count. */
export type WireAnswer = 'rows' | 'page' | 'rowsAndCount' | 'ids' | 'count';

type OpShape = {
  /** What the op does to the entity's rows; a save inserts or updates, so it needs both. */
  readonly access: EntityAccess | 'save';
  readonly answers: WireAnswer;
  /** Whether it addresses one row by its key, its call's `id`. */
  readonly byId?: true;
  /** What its payload is: a row, a list of rows, or an update's changes. */
  readonly writes?: 'row' | 'rows' | 'changes';
};

/**
 * The querier methods a client may call, what each does, and what it answers: the one table the server, every
 * transport and the client read, keyed by {@link UniversalQuerier} method names so a rename is a compile error.
 */
export const API_OPS = {
  findOneById: { access: 'read', answers: 'rows', byId: true },
  findOne: { access: 'read', answers: 'rows' },
  findMany: { access: 'read', answers: 'rows' },
  findManyAndCount: { access: 'read', answers: 'rowsAndCount' },
  findManyPage: { access: 'read', answers: 'page' },
  count: { access: 'read', answers: 'count' },
  insertOne: { access: 'insert', answers: 'ids', writes: 'row' },
  insertMany: { access: 'insert', answers: 'ids', writes: 'rows' },
  saveOne: { access: 'save', answers: 'ids', writes: 'row' },
  saveMany: { access: 'save', answers: 'ids', writes: 'rows' },
  updateMany: { access: 'update', answers: 'count', writes: 'changes' },
  updateOneById: { access: 'update', answers: 'count', byId: true, writes: 'changes' },
  deleteMany: { access: 'delete', answers: 'count' },
  deleteOneById: { access: 'delete', answers: 'count', byId: true },
} as const satisfies Partial<Record<keyof UniversalQuerier, OpShape>>;

export type ApiOp = keyof typeof API_OPS;

const API_OP_KEYS: ReadonlySet<string> = new Set(getKeys(API_OPS));

/**
 * One operation as a client asks for it, plain JSON so it crosses any transport: the entity by its path, the
 * querier method, and what the method takes. The query is decoded and checked on arrival, so it is any object here.
 */
export type WireCall = {
  readonly entity: string;
  readonly op: ApiOp;
  readonly id?: string | number;
  readonly query?: object;
  readonly payload?: unknown;
  readonly hardDelete?: boolean;
};

const CALL_KEYS: ReadonlySet<string> = new Set<keyof WireCall>([
  'entity',
  'op',
  'id',
  'query',
  'payload',
  'hardDelete',
]);

function refused(message: string, key: string): UqlUsageError {
  return new UqlUsageError(message, { path: [key] });
}

/**
 * `value` as a {@link WireCall}, refused otherwise, pointing at the key at fault: what a transport that checks nothing
 * (a tRPC procedure's input) hands the API. A key the op does not take is refused rather than ignored, so a client
 * learns its call was not the one run. What the op needs, and the query and payload's shapes, the call checks itself.
 */
export function parseWireCall(value: unknown): WireCall {
  if (!isPlainObject(value)) {
    throw new UqlUsageError('a call must be a JSON object', { path: [] });
  }
  const stray = getKeys(value).find((key) => !CALL_KEYS.has(key));
  if (stray !== undefined) {
    throw refused(`'${stray}' is no part of a call`, stray);
  }
  const { entity, op, id, query, payload, hardDelete } = value;
  if (typeof entity !== 'string') {
    throw refused("a call names its entity's path in 'entity'", 'entity');
  }
  if (!isApiOp(op)) {
    throw refused(`'${String(op)}' is not an operation the API serves`, 'op');
  }
  const shape: OpShape = API_OPS[op];
  if (id !== undefined && !shape.byId) {
    throw refused(`'${op}' addresses no row by 'id'`, 'id');
  }
  if (id !== undefined && typeof id !== 'string' && typeof id !== 'number') {
    throw refused("a call's 'id' is a string or a number", 'id');
  }
  if (query !== undefined && (shape.writes === 'row' || shape.writes === 'rows')) {
    throw refused(`'${op}' takes no 'query'`, 'query');
  }
  if (query !== undefined && !isPlainObject(query)) {
    throw refused("a call's 'query' must be a JSON object", 'query');
  }
  if (payload !== undefined && !shape.writes) {
    throw refused(`'${op}' writes no 'payload'`, 'payload');
  }
  if (hardDelete !== undefined && shape.access !== 'delete') {
    throw refused(`'${op}' deletes nothing, so takes no 'hardDelete'`, 'hardDelete');
  }
  if (hardDelete !== undefined && typeof hardDelete !== 'boolean') {
    throw refused("a call's 'hardDelete' is a boolean", 'hardDelete');
  }
  return {
    entity,
    op,
    ...(id !== undefined && { id }),
    ...(query !== undefined && { query }),
    ...(payload !== undefined && { payload }),
    ...(hardDelete !== undefined && { hardDelete }),
  };
}

export function isApiOp(op: unknown): op is ApiOp {
  return typeof op === 'string' && API_OP_KEYS.has(op);
}

/**
 * The path an entity is addressed by, e.g. `entityPath(UserProfile) === 'user-profile'`: the `entity` of a call,
 * and the URL segment of its route.
 */
export function entityPath<E>(entity: AbstractType<E>): string {
  return kebabCase(entity.name);
}

export type EntityPathOptions = {
  /**
   * The path an entity is addressed by, its kebab-cased class name by default: the API and its client take the same
   * option, so one map serves both. State it where the default cannot: a build that minifies class names renames
   * every path.
   */
  readonly entityPath?: (entity: AbstractType<unknown>) => string;
};

/** The path each entity is addressed by under `opts`. */
export function entityPathOf(opts: EntityPathOptions): (entity: AbstractType<unknown>) => string {
  return opts.entityPath ?? entityPath;
}

/**
 * What leaves a client, as JSON, refusing what JSON keeps nothing of rather than letting the server build a
 * statement around the remains: a `sql` fragment, which arrives as `{}`, and binary, keyed by index. A `bigint` goes
 * as its digits and a `Date` as its ISO text, which the server reads back by the entity.
 */
export function wireJson(value: unknown): string {
  return JSON.stringify(value, (_key: string, held: unknown) => {
    if (typeof held === 'bigint') {
      return String(held);
    }
    if (typeof held !== 'object' || held === null) {
      return held;
    }
    if (SQL_FN in held) {
      throw new UqlUsageError('raw SQL cannot travel over the wire: what leaves the client is JSON');
    }
    // A blob is a field value, so no type parameter reaches it: this is the only place it is caught.
    if (held instanceof ArrayBuffer || ArrayBuffer.isView(held)) {
      throw new UqlUsageError('binary cannot travel over the wire: what leaves the client is JSON');
    }
    return held;
  });
}
