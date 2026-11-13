import { getContext } from '../context/context.js';
import { GROUP_OPS, groupClauses, isGroupOp } from '../dialect/operators.js';
import { getMeta } from '../entity/metadata/definition.js';
import {
  type AbstractType,
  type ContextKeyRef,
  type ContextWhere,
  type EntityAccess,
  type EntityMeta,
  type FieldKey,
  type FieldMeta,
  type Policy,
  type PolicyMeta,
  type PolicyMode,
  type RowSide,
  type PolicyWhere,
  type PolicyWhen,
  type QueryGroupOp,
  type QueryWhere,
  QuerySql,
  type UqlContext,
} from '../type/index.js';
import { utcTimestamp } from './date.js';
import { isPlainObject } from './object.util.js';
import { whereAnd, whereAnyOf, whereWith } from './query.util.js';

/**
 * What the querier does to hold statements to the policies, under each {@link PolicyMode}: whether it ANDs their
 * scope in (`scopes`), fills and refuses pinned fields (`guards`), reads written rows back against a check (`checks`),
 * and leaves the rest to the database, which it binds the context for (`database`).
 */
export type PolicyEnforcement = {
  readonly scopes: boolean;
  readonly guards: boolean;
  readonly checks: boolean;
  readonly database: boolean;
  /** The context key naming the database role its transactions run as, where the database holds the policies. */
  readonly role?: string;
};

const ENFORCEMENT = {
  app: { scopes: true, guards: true, checks: true, database: false },
  native: { scopes: false, guards: true, checks: false, database: true },
  off: { scopes: false, guards: false, checks: false, database: false },
} as const satisfies Record<string, PolicyEnforcement>;

/** How a pool built with `{ policies: mode }` holds its statements to the policies, the querier's way where unset. */
export function enforcementOf(mode: PolicyMode | undefined): PolicyEnforcement {
  return ENFORCEMENT[mode === false ? 'off' : (mode ?? 'app')];
}

/** Every statement a policy holds where it names none. */
export const POLICY_OPS: readonly EntityAccess[] = ['read', 'insert', 'update', 'delete'];

/** A declared policy as metadata keeps it, its effect read off the key holding its predicate. */
export function policyMeta<E>({ allow, must, ops = POLICY_OPS, ...rest }: Policy<E>): PolicyMeta<E> | undefined {
  const where = allow ?? must;
  return where && { effect: allow === undefined ? 'must' : 'allow', ops, where, ...rest };
}

/** Whether `value` reads a context key, `{ $context: 'tenantId' }`, and nothing else. */
function isContextRef(value: unknown): value is ContextKeyRef {
  return isPlainObject(value) && typeof value['$context'] === 'string' && Object.keys(value).length === 1;
}

/** `value` with each `{ $context }` ref replaced by what `onRef` answers, every other node copied as it was. */
export function mapContextRefs(value: unknown, onRef: (ref: ContextKeyRef) => unknown): unknown {
  if (isContextRef(value)) {
    return onRef(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => mapContextRefs(item, onRef));
  }
  return isPlainObject(value)
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapContextRefs(item, onRef)]))
    : value;
}

/** The context keys `value` reads, in the order met. */
export function contextKeys(value: unknown): Set<string> {
  const keys = new Set<string>();
  mapContextRefs(value, (ref) => keys.add(ref.$context));
  return keys;
}

/**
 * `where` with each context key it reads replaced by the value `context` holds, `undefined` where it holds none for
 * one: a filter reading what the context lacks is skipped, where a policy reaching no row is not.
 */
export function withContextValues<E>(
  where: ContextWhere<E>,
  context: UqlContext | undefined,
): QueryWhere<E> | undefined {
  const bound = bindField(where, fromContext(context));
  return bound === MISSING ? undefined : (bound as QueryWhere<E>);
}

/** A predicate once its context is read: a `$where`, or what it reduced to, every row or none. */
export type BoundWhere<E> = QueryWhere<E> | boolean;

/** No row of `meta`: `$where` has no false, and an empty `$or` reads as no condition at all. */
function noRows<E>(meta: EntityMeta<E>): QueryWhere<E> {
  return whereWith(meta.ids[0]!, { $in: [] });
}

/** `bound` as a `$where` of `meta`: `{}` for every row, {@link noRows} for none. */
export function asWhere<E>(meta: EntityMeta<E>, bound: BoundWhere<E>): QueryWhere<E> {
  return bound === true ? {} : bound === false ? noRows(meta) : bound;
}

/** Every one of `parts`, as one predicate, an `$and` among them spliced in. */
function andBound<E>(parts: readonly BoundWhere<E>[]): BoundWhere<E> {
  if (parts.includes(false)) {
    return false;
  }
  const kept = parts.filter((part): part is QueryWhere<E> => part !== true).flatMap(conjuncts);
  return kept.length === 0 ? true : kept.length === 1 ? kept[0]! : whereAnd(undefined, kept);
}

/** The predicates `where` ANDs: its `$and`'s where that is all it holds and none is SQL, else itself. */
export function conjuncts<E>(where: QueryWhere<E>): QueryWhere<E>[] {
  const parts = Object.keys(where).length === 1 ? where.$and : undefined;
  return parts?.every((part): part is QueryWhere<E> => !(part instanceof QuerySql)) ? [...parts] : [where];
}

/** Any one of `parts`, as one predicate. */
function orBound<E>(parts: readonly BoundWhere<E>[]): BoundWhere<E> {
  if (parts.includes(true)) {
    return true;
  }
  const kept = parts.filter((part): part is QueryWhere<E> => part !== false);
  return kept.length === 0 ? false : kept.length === 1 ? kept[0]! : whereAnyOf(kept);
}

/** `clauses` joined as the group `key` joins them. */
function boundGroup<E>(key: QueryGroupOp, clauses: readonly BoundWhere<E>[]): BoundWhere<E> {
  const { join, negate } = GROUP_OPS[key];
  const group = join === '$and' ? andBound(clauses) : orBound(clauses);
  return negate ? notBound(group) : group;
}

/** Not `bound`. */
function notBound<E>(bound: BoundWhere<E>): BoundWhere<E> {
  return typeof bound === 'boolean' ? !bound : ({ $not: [bound] } as QueryWhere<E>);
}

/** What a context key reads as where the context holds none. */
const MISSING: unique symbol = Symbol('missing');

/**
 * What a context key a policy compares `field` against reads as: its value, {@link MISSING} where the context holds
 * none, or SQL reading it in the database. `field` is `undefined` where the key names no field of the entity.
 */
export type ContextRead = (ref: ContextKeyRef, field: FieldMeta | undefined) => unknown;

/** Reads each key off `context`: an absent key and a null alike are {@link MISSING}, which matches nothing. */
export function fromContext(context: UqlContext | undefined): (ref: ContextKeyRef) => unknown {
  return (ref) => context?.[ref.$context] ?? MISSING;
}

/**
 * `where` with each context key it reads replaced by what `read` answers, the way the database reads a policy: a
 * comparison against a {@link MISSING} key is SQL's unknown, never true, whatever negates it. `positive` is whether
 * the predicate counts where it stands (`false` under a `$not`); a relation's subquery restarts it.
 */
export function bindContext<E>(
  meta: EntityMeta<E>,
  where: PolicyWhere<E>,
  read: ContextRead,
  positive = true,
): BoundWhere<E> {
  if (!contextKeys(where).size) {
    return Object.keys(where).length === 0 || (where as QueryWhere<E>);
  }
  const parts = Object.entries(where).map(([key, value]): BoundWhere<E> => {
    if (isGroupOp(key)) {
      const inner = positive !== GROUP_OPS[key].negate;
      const clauses = groupClauses(key, value as readonly (PolicyWhere<E> | QuerySql)[]).map((item) =>
        item instanceof QuerySql ? whereAnd<E>(undefined, [item]) : bindContext(meta, item, read, inner),
      );
      return boundGroup(key, clauses);
    }
    if (isRowSide(key)) {
      const side = bindContext(meta, value as PolicyWhere<E>, read, positive);
      return typeof side === 'boolean' ? side : ({ [key]: side } as QueryWhere<E>);
    }
    const relation = meta.relations[key];
    if (relation) {
      const bound = bindContext(getMeta(relation.entity!()), value as PolicyWhere<object>, read);
      return bound === false ? false : ({ [key]: bound === true ? {} : bound } as QueryWhere<E>);
    }
    const field = bindField(value, (ref) => read(ref, meta.fields[key as FieldKey<E>]));
    return field === MISSING ? !positive : ({ [key]: field } as QueryWhere<E>);
  });
  return andBound(parts);
}

/** One field's condition with its context read, or {@link MISSING} where a key it compares against is absent. */
function bindField(value: unknown, read: (ref: ContextKeyRef) => unknown): unknown {
  let missing = false;
  const bound = mapContextRefs(value, (ref) => {
    const held = read(ref);
    missing ||= held === MISSING;
    return held;
  });
  return missing ? MISSING : bound;
}

/** The database setting a context key is bound to for the policies the database holds. */
export function contextSetting(key: string): string {
  return `uql.${key}`;
}

/** A context key a policy may read, which names a database setting as it is. */
export const POLICY_CONTEXT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The keys of `context` a database binds for the policies it holds, each with its value as text: a scalar or a date,
 * under a key a policy may read. Any other is left unbound, which a policy reads as NULL.
 */
export function contextEntries(context: UqlContext | undefined): [string, string][] {
  return Object.entries(context ?? {}).flatMap(([key, value]): [string, string][] => {
    if (!POLICY_CONTEXT_KEY.test(key)) {
      return [];
    }
    if (value instanceof Date) {
      return [[key, utcTimestamp(value)]];
    }
    const scalar =
      typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean';
    return scalar ? [[key, String(value)]] : [];
  });
}

/** The database role `entries` bind at the pool's role `key`: none where unset, or set empty to unbind it. */
export function roleOf(entries: readonly (readonly [string, string])[], key: string | undefined): string | undefined {
  return entries.find(([it]) => it === key)?.[1] || undefined;
}

/** The context of a transaction that bound none yet, or whose binding a savepoint's rollback undid. */
const UNBOUND: unique symbol = Symbol('unbound');

/** What a transaction bound for the database's policies: the context it last bound, and every key it bound so far. */
export type BoundContext = {
  readonly context: UqlContext | undefined | typeof UNBOUND;
  readonly keys: readonly string[];
};

export const NOTHING_BOUND: BoundContext = { context: UNBOUND, keys: [] };

/** `bound` after a savepoint's rollback, which may bring back any key bound before it: the next statement binds again. */
export function unsettled(bound: BoundContext): BoundContext {
  return { context: UNBOUND, keys: bound.keys };
}

/**
 * What binds `context` over `bound`: its entries, each key the transaction bound that it lacks set empty, and what is
 * bound once they are sent. No entry where `context` is the one bound.
 */
export function nextBinding(
  bound: BoundContext,
  context: UqlContext | undefined,
): { entries: [string, string][]; bound: BoundContext } {
  if (bound.context === context) {
    return { entries: [], bound };
  }
  const entries = contextEntries(context);
  const keys = entries.map(([key]) => key);
  const stale = bound.keys.filter((key) => !keys.includes(key));
  return {
    entries: [...entries, ...stale.map((key): [string, string] => [key, ''])],
    bound: { context, keys: [...keys, ...stale] },
  };
}

/** Whether `context` holds every key `when` names at its value, or at one of them where it lists several. */
function holdsWhen(when: PolicyWhen | undefined, context: UqlContext | undefined): boolean {
  return Object.entries(when ?? {}).every(([key, value]) =>
    Array.isArray(value) ? value.includes(context?.[key]) : context?.[key] === value,
  );
}

/** The name of the policy a `tenant()` column registers, and of the `allow` an entity declaring none is given. */
export const TENANT_POLICY = 'tenant';
export const EVERY_ROW_POLICY = 'everyRow';

/** The `must` holding each row of `meta` to the tenant `key` stores, read off context key `contextKey`. */
export function tenantPolicy<E>(key: FieldKey<E>, contextKey: string): PolicyMeta<E> {
  return { effect: 'must', ops: POLICY_OPS, where: whereWith(key, { $context: contextKey }), name: TENANT_POLICY };
}

/**
 * The policies holding `meta`: its own, and where none of them is an `allow`, one reaching every row, so its `must`s
 * alone narrow what it reaches. An entity declaring an `allow` reaches no row in a statement none of them holds.
 */
export function policiesOf<E>(policies: readonly PolicyMeta<E>[]): readonly PolicyMeta<E>[] {
  return policies.some((policy) => policy.effect === 'allow')
    ? policies
    : [...policies, { effect: 'allow', ops: POLICY_OPS, where: {}, name: EVERY_ROW_POLICY }];
}

/**
 * The policies each side a statement reads is held to: `$old`, the row as found, and `$new`, the row as written. An
 * update and a delete find their rows as a read does, as Postgres holds them.
 */
export const POLICY_SIDES: Readonly<Record<EntityAccess, Partial<Record<RowSide, readonly EntityAccess[]>>>> = {
  read: { $old: ['read'] },
  delete: { $old: ['read', 'delete'] },
  insert: { $new: ['insert'] },
  update: { $old: ['read', 'update'], $new: ['update'] },
};

/** Whether a statement doing `access` has both rows, the only one a predicate may pair them for: an update. */
export function pairsRows(access: EntityAccess): boolean {
  const sides = POLICY_SIDES[access];
  return !!(sides.$old && sides.$new);
}

/** The refusal of a row an update moves where no transition of `entity`'s lets it, in the querier and the database. */
export function movesRefused(entity: string): string {
  return `a row of '${entity}' moves where its policies do not let it`;
}

/** Whether `key` names a row of a policy's predicate. */
export function isRowSide(key: string): key is RowSide {
  return key === '$old' || key === '$new';
}

/** The conditions `where` ANDs, each `$and`'s spliced in, as one-key predicates. */
function conjunctParts<E>(where: PolicyWhere<E>): PolicyWhere<E>[] {
  return Object.entries(where).flatMap(([key, value]): PolicyWhere<E>[] =>
    key === '$and' && Array.isArray(value)
      ? value.flatMap((clause: PolicyWhere<E> | QuerySql): PolicyWhere<E>[] =>
          clause instanceof QuerySql ? [{ $and: [clause] } as PolicyWhere<E>] : conjunctParts(clause),
        )
      : [{ [key]: value } as PolicyWhere<E>],
  );
}

/** Whether `part` pairs both rows: a group reading a side, which no one side answers. */
function pairs<E>(part: PolicyWhere<E>): boolean {
  return Object.keys(part).some(isGroupOp) && sidesOf(part).size > 0;
}

/** The groups of `where` pairing both rows: the transitions an update is held to. */
export function transitionsOf<E>(where: PolicyWhere<E>): PolicyWhere<E>[] {
  return conjunctParts(where).filter(pairs);
}

/** The sides `where` reads at its root or in a group, where a policy may read them. */
export function sidesOf(where: unknown): Set<RowSide> {
  const sides = new Set<RowSide>();
  if (isPlainObject(where)) {
    for (const [key, value] of Object.entries(where)) {
      if (isRowSide(key)) {
        sides.add(key);
      } else if (isGroupOp(key)) {
        groupClauses(key, value as readonly unknown[]).forEach((clause) =>
          sidesOf(clause).forEach((side) => sides.add(side)),
        );
      }
    }
  }
  return sides;
}

/** `parts` as one predicate: merged where their keys differ, else an `$and`. */
function allOf<E>(parts: readonly ContextWhere<E>[]): ContextWhere<E> {
  const keys = parts.flatMap((part) => Object.keys(part));
  if (parts.length === 1 || new Set(keys).size === keys.length) {
    return Object.assign({}, ...parts) as ContextWhere<E>;
  }
  return { $and: parts } as ContextWhere<E>;
}

/**
 * `where` as one side reads it: its conditions on every row and those on `side`, those on the other side left out, as
 * is a group pairing both rows, which {@link policyTransitions} holds.
 */
export function project<E>(where: PolicyWhere<E>, side: RowSide): ContextWhere<E> {
  if (!sidesOf(where).size) {
    return where as ContextWhere<E>;
  }
  return allOf(
    conjunctParts(where).flatMap((part): ContextWhere<E>[] => {
      const [key] = Object.keys(part);
      if (isRowSide(key!)) {
        return key === side ? [part[key] as ContextWhere<E>] : [];
      }
      return pairs(part) ? [] : [part as ContextWhere<E>];
    }),
  );
}

/**
 * The rows `side` of every statement in `accesses` may be: each `must` holding one, and for each, an `allow` holding
 * it, statements the same allows hold ORing them in once.
 */
function joined<E>(
  meta: EntityMeta<E>,
  declared: readonly PolicyMeta<E>[],
  accesses: readonly EntityAccess[],
  context: UqlContext | undefined,
  side: RowSide,
): BoundWhere<E> {
  const policies = policiesOf(declared).filter(
    (policy) => accesses.some((access) => policy.ops.includes(access)) && holdsWhen(policy.when, context),
  );
  const read = fromContext(context);
  const bound = policies.map((policy) => bindContext(meta, project(policy.where, side), read));
  const allowSets = new Map(
    accesses.map((access) => {
      const set = policies.flatMap((policy, at) =>
        policy.effect === 'allow' && policy.ops.includes(access) ? [at] : [],
      );
      return [set.join(), set];
    }),
  );
  return andBound([
    ...bound.filter((_, at) => policies[at].effect === 'must'),
    ...[...allowSets.values()].map((set) => orBound(set.map((at) => bound[at]))),
  ]);
}

/**
 * What `side` of a row a statement doing `access` touches must be under `context`: the rows it reaches as found, and
 * what it writes. `undefined` for an entity with no policies, or a side the statement has none of.
 */
export function policyWhere<E>(
  meta: EntityMeta<E>,
  access: EntityAccess,
  side: RowSide,
  context: UqlContext | undefined,
): BoundWhere<E> | undefined {
  const accesses = POLICY_SIDES[access][side];
  const { policies } = meta;
  return policies?.length && accesses ? joined(meta, policies, accesses, context, side) : undefined;
}

/**
 * The transitions an update is held to under `context`: each group pairing both rows of a `must` holding updates, its
 * context read, `$old` the row as found and `$new` as written. None that holds whatever the rows.
 */
export function policyTransitions<E>(meta: EntityMeta<E>, context: UqlContext | undefined): (QueryWhere<E> | false)[] {
  const read = fromContext(context);
  return (meta.policies ?? [])
    .filter((policy) => holdsWhen(policy.when, context))
    .flatMap((policy) => boundTransitions(meta, policy, read));
}

/**
 * `policy`'s transitions, each with its context read by `read`, those holding whatever the rows left out. Only a `must`
 * holding updates states one, which registering a policy enforces.
 */
export function boundTransitions<E>(
  meta: EntityMeta<E>,
  policy: PolicyMeta<E>,
  read: ContextRead,
): (QueryWhere<E> | false)[] {
  return transitionsOf(policy.where)
    .map((part) => bindContext(meta, part, read))
    .filter((bound): bound is QueryWhere<E> | false => bound !== true);
}

/**
 * `transition` with each read of the row as found answered by `held`, whether the row holds it, met in the order
 * {@link oldReads} lists them: what is left holds the row as written. A condition beside no side holds both rows.
 */
export function onWritten<E>(transition: PolicyWhere<E> | QueryWhere<E>, held: (at: number) => boolean): BoundWhere<E> {
  let at = 0;
  return walkTransition(transition, true, () => held(at++));
}

/**
 * What `transition` reads of the row as found, in the order {@link onWritten} meets them. A condition under a
 * negation is read negated, so a null the condition cannot decide lets nothing go, as the database's `IS NOT TRUE`.
 */
export function oldReads<E>(transition: PolicyWhere<E> | QueryWhere<E>): QueryWhere<E>[] {
  const reads: QueryWhere<E>[] = [];
  walkTransition(transition, true, (read) => {
    reads.push(read);
    return true;
  });
  return reads;
}

/**
 * One walk of a transition for both {@link oldReads} and {@link onWritten}, so the two meet its conditions alike:
 * `held` answers whether the row as found holds each read, which is the condition itself where `positive`.
 */
function walkTransition<E>(
  where: PolicyWhere<E> | QueryWhere<E>,
  positive: boolean,
  held: (read: QueryWhere<E>) => boolean,
): BoundWhere<E> {
  const found = (condition: QueryWhere<E>) =>
    positive ? held(condition) : !held({ $not: [condition] } as QueryWhere<E>);
  const parts = Object.entries(where).map(([key, value]): BoundWhere<E> => {
    if (isGroupOp(key)) {
      const inner = positive !== GROUP_OPS[key].negate;
      const clauses = groupClauses(key, value as readonly PolicyWhere<E>[]).map((clause) =>
        walkTransition(clause, inner, held),
      );
      return boundGroup(key, clauses);
    }
    if (key === '$old') {
      return found(value as QueryWhere<E>);
    }
    if (key === '$new') {
      return value as QueryWhere<E>;
    }
    const leaf = { [key]: value } as QueryWhere<E>;
    return andBound([found(leaf), leaf]);
  });
  return andBound(parts);
}

/** What `explainPolicies` answers: each side a statement reads, and the transitions an update is held to. */
export type ExplainedPolicies<E> = {
  readonly $old?: QueryWhere<E>;
  readonly $new?: QueryWhere<E>;
  readonly $and?: readonly QueryWhere<E>[];
};

/**
 * What `entity`'s policies hold a statement doing `access` to under `context`, the ambient one where unset, as a
 * policy states it: `$old`, the rows it reaches (`{}` for every one), `$new`, what a row it writes must hold, and an
 * update's transitions. None for an entity with no policies. It answers why a read under a context reaches no row.
 */
export function explainPolicies<E>(
  entity: AbstractType<E>,
  access: EntityAccess,
  context: UqlContext | undefined = getContext(),
): ExplainedPolicies<E> {
  const meta = getMeta(entity);
  const found = policyWhere(meta, access, '$old', context);
  const written = policyWhere(meta, access, '$new', context);
  const transitions = pairsRows(access) ? policyTransitions(meta, context) : [];
  return {
    ...(found === undefined ? {} : { $old: asWhere(meta, found) }),
    ...(written === undefined ? {} : { $new: asWhere(meta, written) }),
    ...(transitions.length ? { $and: transitions.map((bound) => asWhere(meta, bound)) } : {}),
  };
}
