import { getMeta } from '../entity/metadata/definition.js';
import type {
  AbstractType,
  EntityAccess,
  EntityMeta,
  FieldAccess,
  FieldMeta,
  RelationMeta,
  Type,
  Wire,
} from '../type/index.js';
import { isCascadable } from '../util/dialect.util.js';
import { fieldKeys, isFieldKey, isWrittenOn } from '../util/field.util.js';
import { isPlainObject, isRecord } from '../util/object.util.js';
import { UqlSecurityError, type UqlErrorPath } from '../util/uqlError.js';
import { chain, type EntityMiddleware, isCallOf } from './apiCall.js';
import { API_OPS, type ApiOp } from './wireCall.js';

/** How an API serves an entity beyond what its definition's `wire` states: middleware of its own. */
export type ServeOptions<E, Ctx = unknown> = {
  readonly use: readonly EntityMiddleware<E, Ctx>[];
};

/** An entity an API serves with {@link ServeOptions}, as `include` lists it beside an entity served as it is. */
export type Served<E, Ctx = unknown> = {
  readonly entity: Type<E>;
  /** Its middleware, run on its own calls alone, after the API's. */
  readonly around: EntityMiddleware<object, Ctx>;
};

/**
 * Serve `entity` in an API's `include` with middleware of its own in `use`: typed by the entity, so it reads and
 * writes its members, and run on the entity's own calls alone.
 */
export function serve<E extends object, Ctx = unknown>(entity: Type<E>, { use }: ServeOptions<E, Ctx>): Served<E, Ctx> {
  return {
    entity,
    around: (call, context, next) => (isCallOf(entity, call) ? chain<E, Ctx>(use, context, next)(call) : next(call)),
  };
}

/** The entities an API serves, each to its middleware. */
export type ServedEntities = ReadonlyMap<AbstractType<object>, unknown>;

/** An `include` item as the entity it serves and that entity's middleware. */
export function servedEntry<Ctx>(
  item: Type<object> | Served<object, Ctx>,
): [Type<object>, EntityMiddleware<object, Ctx> | undefined] {
  return typeof item === 'function' ? [item, undefined] : [item.entity, item.around];
}

const PAST: Readonly<Record<EntityAccess, string>> = {
  read: 'read',
  insert: 'inserted',
  update: 'updated',
  delete: 'deleted',
};

/** What a save does to the rows it writes, as a cascade does to the rows a write nests: inserts new ones, updates listed ones. */
const SAVED: readonly FieldAccess[] = ['insert', 'update'];

/** What `op` does to the rows it writes, a save doing either. */
function writesOf(op: ApiOp): readonly FieldAccess[] {
  const { access } = API_OPS[op];
  return access === 'save' ? SAVED : access === 'insert' || access === 'update' ? [access] : [];
}

/** The relation `key` names on `meta`, a client's key included: an own key alone, never one of `Object`'s. */
function relationAt<E>(meta: EntityMeta<E>, key: string): RelationMeta | undefined {
  const relations: Readonly<Record<string, RelationMeta | undefined>> = meta.relations;
  return Object.hasOwn(relations, key) ? relations[key] : undefined;
}

/**
 * Refuses what a client's call reaches that the API does not expose: the op on its entity, a relation to an entity
 * it does not serve, and a member at any depth of the query (read) or the rows it writes. Every `$` clause holds
 * keys of the entity it sits on.
 */
export function assertExposed<E extends object>(
  meta: EntityMeta<E>,
  op: ApiOp,
  query: object,
  payload: unknown,
  served: ServedEntities,
): void {
  const { access } = API_OPS[op];
  const writes = writesOf(op);
  assertOps(meta, access === 'save' ? writes : [access], served);
  walk(meta, query, ['read'], served, ['query']);
  walk(meta, payload, writes, served, ['payload']);
}

function assertOps<E extends object>(
  meta: EntityMeta<E>,
  needs: readonly EntityAccess[],
  served: ServedEntities,
  path?: UqlErrorPath,
): void {
  const missing = needs.find((need) => !served.has(meta.entity) || !takes(meta.wire, need));
  if (missing) {
    throw new UqlSecurityError(`'${meta.entity.name}' cannot be ${PAST[missing]} through this API`, { path });
  }
}

/** The members `path` names, as a refusal reads them: `author.email`, not its clauses and indexes. */
function membersOf(path: UqlErrorPath): string {
  return path
    .slice(1)
    .filter((key) => typeof key === 'string' && !key.startsWith('$'))
    .join('.');
}

function walk<E extends object>(
  meta: EntityMeta<E>,
  sent: unknown,
  needs: readonly FieldAccess[],
  served: ServedEntities,
  path: UqlErrorPath,
): void {
  if (Array.isArray(sent)) {
    sent.forEach((item, index) => walk(meta, item, needs, served, [...path, index]));
    return;
  }
  if (!isRecord(sent)) {
    return;
  }
  const writing = !needs.includes('read');
  for (const [key, value] of Object.entries(sent)) {
    if (key.startsWith('$')) {
      walk(meta, value, needs, served, [...path, key]);
      continue;
    }
    // A JSON path (`kind.plan`) reads the member it starts at.
    const [member] = key.split('.');
    const relation = relationAt(meta, member);
    const field = !relation && isFieldKey(meta, member) ? meta.fields[member] : undefined;
    const declared = relation ?? field;
    if (!declared) {
      continue;
    }
    const at = [...path, key];
    const missing = needs.find((need) => !takes(declared.wire, need)) ?? (field && dropped(field, needs));
    if (missing) {
      throw new UqlSecurityError(`'${membersOf(at)}' cannot be ${PAST[missing]} through this API`, { path: at });
    }
    // The querier writes a relation a payload names only where it cascades, saving its rows whatever the op.
    if (relation && (!writing || isCascadable('persist', relation.cascade))) {
      const target = getMeta(relation.entity());
      if (!served.has(target.entity)) {
        throw new UqlSecurityError(
          `'${membersOf(at)}' reaches '${target.entity.name}', which this API does not serve`,
          { path: at },
        );
      }
      const nested = writing ? SAVED : needs;
      // An update of a to-many replaces its rows: those it stops listing are deleted.
      const replaces = relation.cardinality === '1m' && needs.includes('update');
      assertOps(target, replaces ? [...nested, 'delete'] : nested, served, at);
      walk(target, value, nested, served, at);
    }
  }
}

/** Whether a `wire` lets a client do `need`: everything where it states none. */
function takes<A extends EntityAccess>(wire: Wire<A> | undefined, need: A): boolean {
  return wire === undefined || (wire !== false && wire.includes(need));
}

/**
 * What a write is refused for where the querier would write `field` on none of `needs`, rather than drop it unseen: a
 * computed value, or an `updatable(false)` one in an update. A save or a cascade may insert, which writes the latter.
 */
function dropped(field: FieldMeta, needs: readonly FieldAccess[]): FieldAccess | undefined {
  const writes = (need: FieldAccess) =>
    need === 'read' || isWrittenOn(field, need === 'insert' ? 'onInsert' : 'onUpdate');
  return needs.some(writes) ? undefined : needs[0];
}

/**
 * `query` reading no field whose `wire` keeps it from being read, at every depth its `$populate` reaches. Run on a
 * call {@link assertExposed} took, which names none of them: a projection naming the fields it reads stays as it is.
 */
export function hideUnreadable<E extends object, Q extends Readonly<Record<string, unknown>>>(
  meta: EntityMeta<E>,
  query: Q,
): Q {
  const hidden = fieldKeys(meta, (field) => !takes(field.wire, 'read'));
  const select = query['$select'];
  const leavesOut = select === undefined || (isPlainObject(select) && Object.values(select).every((value) => !value));
  const $select =
    hidden.length && leavesOut
      ? { ...(isPlainObject(select) && select), ...Object.fromEntries(hidden.map((key) => [key, false])) }
      : select;
  const $populate = isPlainObject(query['$populate']) ? populateOf(meta, query['$populate']) : query['$populate'];
  if ($select === select && $populate === query['$populate']) {
    return query;
  }
  return { ...query, ...($select !== undefined && { $select }), ...($populate !== undefined && { $populate }) };
}

function populateOf<E extends object>(meta: EntityMeta<E>, populate: Record<string, unknown>): object {
  let changed = false;
  const entries = Object.entries(populate).map(([key, nested]) => {
    const relation = relationAt(meta, key);
    if (!relation || !nested) {
      return [key, nested];
    }
    const read = hideUnreadable(getMeta(relation.entity()), isPlainObject(nested) ? nested : {});
    const hid = isPlainObject(nested) ? read !== nested : Object.keys(read).length > 0;
    changed ||= hid;
    return [key, hid ? read : nested];
  });
  return changed ? Object.fromEntries(entries) : populate;
}

/**
 * The query a client's call runs with: refused where it reaches what the API does not expose, and, on a read
 * answering rows, leaving out what it may not read.
 */
export function exposedQuery<E extends object, Q extends Readonly<Record<string, unknown>>>(
  meta: EntityMeta<E>,
  op: ApiOp,
  query: Q,
  payload: unknown,
  served: ServedEntities,
): Q {
  assertExposed(meta, op, query, payload, served);
  const { access, answers } = API_OPS[op];
  return access === 'read' && answers !== 'count' ? hideUnreadable(meta, query) : query;
}
