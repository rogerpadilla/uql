import type { EntityAccess, UqlContext } from './query.js';
import type { QuerySql, SQL_VALUE_TYPE } from './querySql.js';
import type { QueryWhere, QueryWhereFields, QueryWhereRootOperator, RowsWhere } from './queryWhere.js';

/**
 * A context key read where a policy's predicate takes a value, as data: `{ $context: 'tenantId' }`. Read off
 * {@link $context}, which types it by {@link UqlContext}, so a key holding a string never meets a number column.
 */
export type ContextRef<T = unknown> = unknown extends T
  ? ContextKeyRef
  : ContextKeyRef & { readonly [SQL_VALUE_TYPE]?: NonNullable<T> };

/** A {@link ContextRef} whatever its value's type. */
export type ContextKeyRef = { readonly $context: string };

/** The keys a declaration of {@link UqlContext} names, its index signature left out. */
type DeclaredContextKey = keyof {
  [K in keyof UqlContext as string extends K ? never : number extends K ? never : K]: unknown;
};

/**
 * A context key a policy may read: one {@link UqlContext} declares, so a misspelled key does not compile. Any string
 * where the app declares none.
 */
export type ContextKey = [DeclaredContextKey] extends [never] ? string : DeclaredContextKey & string;

/** The value context key `K` holds, `unknown` for one no declaration names. */
type ContextValue<K extends string> = K extends keyof UqlContext ? UqlContext[K] : unknown;

/**
 * The context's keys as {@link ContextRef}s, each read as `$context.tenantId`: mapped over {@link UqlContext} itself, so
 * a rename of a declared key reaches every read of it. Any key where the app declares none.
 */
export type ContextRefs = string extends ContextKey
  ? { readonly [key: string]: ContextRef }
  : { readonly [K in keyof UqlContext as K extends ContextKey ? K : never]-?: ContextRef<UqlContext[K]> };

/**
 * What `tenant()` takes: a column of value `V` reads its tenant off `$context.tenantId` unless given another key, which
 * must hold such a value; required where `tenantId` holds none.
 */
export type TenantKey<V> = string extends ContextKey
  ? [contextKey?: ContextRef<V>]
  : [ContextRef<ContextValue<'tenantId'>>] extends [ContextRef<V>]
    ? 'tenantId' extends ContextKey
      ? [contextKey?: ContextRef<V>]
      : [contextKey: ContextRef<V>]
    : [contextKey: ContextRef<V>];

/** What a policy's predicate interpolates where a query takes SQL: SQL itself, or a context key. */
export type PolicySql = QuerySql | ContextKeyRef;

/** A `$where` over the entity, its relations included, whose values may read the context: a filter's, a row's. */
export type ContextWhere<E> = QueryWhere<E, PolicySql>;

/**
 * A policy's predicate: a {@link ContextWhere} holding every row a statement touches, and `$old` the row as found or
 * `$new` the row as written alone, grouped as any condition is: `{ $or: [{ $old: { status: 'draft' } }, ...] }`.
 */
export type PolicyWhere<E> = RowsWhere<
  QueryWhereFields<E, PolicySql> & Pick<QueryWhereRootOperator<E, PolicySql>, '$text' | '$exists' | '$nexists'>,
  ContextWhere<E>,
  PolicySql
>;

/**
 * How a policy joins the others holding a statement: rows any `allow` reaches, and of them only those every `must`
 * holds, Postgres's permissive and restrictive policies. An entity with policies and no `allow` for a statement
 * reaches no row in it.
 */
export type PolicyEffect = 'allow' | 'must';

/**
 * The context a policy holds under, each key at its value or at one it lists: `{ role: ['admin', 'owner'] }`. Folded
 * before the statement is written.
 */
export type PolicyWhen = string extends ContextKey
  ? { readonly [key: string]: unknown }
  : { readonly [K in keyof UqlContext as K extends ContextKey ? K : never]?: UqlContext[K] | readonly UqlContext[K][] };

/** What a policy states beyond its predicate. */
export type PolicyOptions<E> = {
  /** The statements it holds, every one where unset. An update and a delete are held to the `read` ones too. */
  readonly ops?: readonly EntityAccess[];
  readonly when?: PolicyWhen;
  /** Names it in the database; derived from its effect and position where unset. */
  readonly name?: string;
};

/** A policy as entity metadata keeps it, its effect and statements stated. */
export type PolicyMeta<E = object> = Omit<PolicyOptions<E>, 'ops'> & {
  readonly effect: PolicyEffect;
  readonly ops: readonly EntityAccess[];
  readonly where: PolicyWhere<E>;
};

/**
 * One policy as an entity declares it: its effect keyed to the rows it reaches, `{}` for all, beside its options.
 * Data throughout, a context key read off {@link $context}: `{ must: { tenantId: $context.tenantId } }`.
 */
export type Policy<E> = PolicyOptions<E> &
  (
    | { readonly allow: PolicyWhere<E>; readonly must?: never }
    | { readonly must: PolicyWhere<E>; readonly allow?: never }
  );

/**
 * An entity's row-level policies, in order: `[{ must: { tenantId: $context.tenantId } }, { allow: { ownerId:
 * $context.userId } }]`. See architecture/row-level-security.md.
 */
export type PolicySection<E> = readonly Policy<E>[];
