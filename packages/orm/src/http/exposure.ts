import { getMeta } from '../entity/metadata/definition.js';
import type {
  AbstractType,
  EntityAccess,
  EntityMeta,
  FieldAccess,
  FieldKey,
  RelationKey,
  RelationMeta,
  Type,
} from '../type/index.js';
import { isCascadable } from '../util/dialect.util.js';
import { isFieldKey } from '../util/field.util.js';
import { isPlainObject, isRecord } from '../util/object.util.js';
import { UqlSecurityError, type UqlErrorPath } from '../util/uqlError.js';
import { chain, type EntityMiddleware, isCallOf } from './apiCall.js';
import { API_OPS, type ApiOp } from './wireCall.js';

/**
 * What a client may do to an entity and each of its members, fields and relations: what is not listed takes every
 * operation, and `false` takes none. The map is declared over `F`, so a rename follows and a typo does not compile.
 */
export type Exposure<E, F extends keyof E = FieldKey<E> | RelationKey<E>> = {
  readonly ops?: readonly EntityAccess[];
  readonly members?: { readonly [K in F]?: false | readonly FieldAccess[] };
};

/** An entity an API serves under an {@link Exposure}, as `include` lists it beside an entity served whole. */
export type Served<E, Ctx = unknown> = {
  readonly entity: Type<E>;
  readonly exposure: Exposure<E>;
  /** Its middleware, run on its own calls alone, after the API's; none where it names none. */
  readonly around?: EntityMiddleware<object, Ctx>;
};

/**
 * Serve `entity` under `exposure`, in an API's `include`, with middleware of its own in `use`: typed by the entity,
 * so it reads and writes its members, and run on the entity's own calls alone.
 */
export function serve<E extends object, Ctx = unknown>(
  entity: Type<E>,
  { use = [], ...exposure }: Exposure<E> & { readonly use?: readonly EntityMiddleware<E, Ctx>[] },
): Served<E, Ctx> {
  if (!use.length) {
    return { entity, exposure };
  }
  return {
    entity,
    exposure,
    around: (call, context, next) => (isCallOf(entity, call) ? chain<E, Ctx>(use, context, next)(call) : next(call)),
  };
}

/** An exposure worked out once: an entity's operations, and the members it narrows, each to what it takes. */
type Policy = {
  readonly ops: ReadonlySet<EntityAccess>;
  readonly members: ReadonlyMap<string, ReadonlySet<FieldAccess>>;
};

export type Exposures = ReadonlyMap<AbstractType<object>, Policy>;

const EVERY_OP: ReadonlySet<EntityAccess> = new Set(['read', 'insert', 'update', 'delete']);

/** The entity an `include` item serves. */
export function entityOf<Ctx>(item: Type<object> | Served<object, Ctx>): Type<object> {
  return typeof item === 'function' ? item : item.entity;
}

/** Each entity `include` lists, by its class, with what it takes. */
export function exposuresOf<Ctx>(include: readonly (Type<object> | Served<object, Ctx>)[]): Exposures {
  return new Map(
    include.map((item) => {
      const entity = entityOf(item);
      const exposure: Exposure<object> = typeof item === 'function' ? {} : item.exposure;
      const members = Object.entries<false | readonly FieldAccess[] | undefined>(exposure.members ?? {}).map(
        ([key, takes]): [string, ReadonlySet<FieldAccess>] => [key, new Set(takes || [])],
      );
      return [entity, { ops: exposure.ops ? new Set(exposure.ops) : EVERY_OP, members: new Map(members) }];
    }),
  );
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
  exposures: Exposures,
): void {
  const { access } = API_OPS[op];
  const writes = writesOf(op);
  assertOps(meta, access === 'save' ? writes : [access], exposures);
  walk(meta, query, ['read'], exposures, ['query']);
  walk(meta, payload, writes, exposures, ['payload']);
}

/** An entity the API does not serve takes nothing. */
const DENIED: Policy = { ops: new Set(), members: new Map() };

function policyOf<E extends object>(meta: EntityMeta<E>, exposures: Exposures): Policy {
  return exposures.get(meta.entity) ?? DENIED;
}

function assertOps<E extends object>(
  meta: EntityMeta<E>,
  needs: readonly EntityAccess[],
  exposures: Exposures,
  path?: UqlErrorPath,
): void {
  const missing = needs.find((need) => !policyOf(meta, exposures).ops.has(need));
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
  exposures: Exposures,
  path: UqlErrorPath,
): void {
  if (Array.isArray(sent)) {
    sent.forEach((item, index) => walk(meta, item, needs, exposures, [...path, index]));
    return;
  }
  if (!isRecord(sent)) {
    return;
  }
  const { members } = policyOf(meta, exposures);
  const writing = !needs.includes('read');
  for (const [key, value] of Object.entries(sent)) {
    if (key.startsWith('$')) {
      walk(meta, value, needs, exposures, [...path, key]);
      continue;
    }
    // A JSON path (`kind.plan`) reads the member it starts at.
    const [member] = key.split('.');
    const relation = relationAt(meta, member);
    if (!relation && !isFieldKey(meta, member)) {
      continue;
    }
    const at = [...path, key];
    const takes = members.get(member);
    const missing = takes && needs.find((need) => !takes.has(need));
    if (missing) {
      throw new UqlSecurityError(`'${membersOf(at)}' cannot be ${PAST[missing]} through this API`, { path: at });
    }
    // The querier writes a relation a payload names only where it cascades, saving its rows whatever the op.
    if (relation && (!writing || isCascadable('persist', relation.cascade))) {
      const target = getMeta(relation.entity());
      if (!exposures.has(target.entity)) {
        throw new UqlSecurityError(
          `'${membersOf(at)}' reaches '${target.entity.name}', which this API does not serve`,
          { path: at },
        );
      }
      const nested = writing ? SAVED : needs;
      // An update of a to-many replaces its rows: those it stops listing are deleted.
      const replaces = relation.cardinality === '1m' && needs.includes('update');
      assertOps(target, replaces ? [...nested, 'delete'] : nested, exposures, at);
      walk(target, value, nested, exposures, at);
    }
  }
}

/** What a projection of `meta` leaves out because the API does not let it be read: its fields alone, never a relation. */
function unreadableOf<E extends object>(meta: EntityMeta<E>, exposures: Exposures): string[] {
  const { members } = policyOf(meta, exposures);
  return [...members].filter(([key, takes]) => !takes.has('read') && isFieldKey(meta, key)).map(([key]) => key);
}

/**
 * `query` reading none of what the API does not let be read, at every depth its `$populate` reaches. Run on a call
 * {@link assertExposed} took, which names none of it: a projection naming the fields it reads stays as it is.
 */
export function hideUnreadable<E extends object, Q extends Readonly<Record<string, unknown>>>(
  meta: EntityMeta<E>,
  query: Q,
  exposures: Exposures,
): Q {
  const hidden = unreadableOf(meta, exposures);
  const select = query['$select'];
  const leavesOut = select === undefined || (isPlainObject(select) && Object.values(select).every((value) => !value));
  const $select =
    hidden.length && leavesOut
      ? { ...(isPlainObject(select) && select), ...Object.fromEntries(hidden.map((key) => [key, false])) }
      : select;
  const $populate = isPlainObject(query['$populate'])
    ? populateOf(meta, query['$populate'], exposures)
    : query['$populate'];
  if ($select === select && $populate === query['$populate']) {
    return query;
  }
  return { ...query, ...($select !== undefined && { $select }), ...($populate !== undefined && { $populate }) };
}

function populateOf<E extends object>(
  meta: EntityMeta<E>,
  populate: Record<string, unknown>,
  exposures: Exposures,
): object {
  let changed = false;
  const entries = Object.entries(populate).map(([key, nested]) => {
    const relation = relationAt(meta, key);
    if (!relation || !nested) {
      return [key, nested];
    }
    const read = hideUnreadable(getMeta(relation.entity()), isPlainObject(nested) ? nested : {}, exposures);
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
  exposures: Exposures,
): Q {
  assertExposed(meta, op, query, payload, exposures);
  const { access, answers } = API_OPS[op];
  return access === 'read' && answers !== 'count' ? hideUnreadable(meta, query, exposures) : query;
}
