import { getMeta } from '../entity/metadata/definition.js';
import {
  ColumnRef,
  type EntityMeta,
  type EntitySql,
  type EntityWhere,
  type EntityWhereMeta,
  QueryRaw,
  type QueryRawFn,
  type AggregatePage,
  type ComputedRefs,
  type QueryRawRenderOptions,
  type RefMap,
  RelationAggregate,
  type RelationAggregateOp,
  type RelationAggregateSpec,
  type Type,
} from '../type/index.js';
import { isInlinedExpression } from './field.util.js';

/**
 * Raw SQL, where an interpolated value binds, a `refs` field renders its column, and a `raw` renders
 * in place: `raw`GREATEST(0, ${user.credits} - ${amount})``. A callback writes whatever it writes, so
 * never build one from user input. See the Raw SQL guide.
 */
export function raw(strings: TemplateStringsArray, ...values: readonly unknown[]): QueryRaw;
export function raw(value: QueryRawFn): QueryRaw;
export function raw(value: QueryRawFn | TemplateStringsArray, ...rest: readonly unknown[]): QueryRaw {
  if (!isTemplateStrings(value)) {
    return new QueryRaw(value);
  }
  return new QueryRaw((opts) => {
    const { ctx } = opts;
    ctx.append(value[0]);
    rest.forEach((interpolated, i) => {
      if (interpolated instanceof QueryRaw) {
        interpolated.render(opts);
      } else {
        ctx.addValue(interpolated);
      }
      ctx.append(value[i + 1]);
    });
  });
}

/**
 * The fields of `entity` as {@link ColumnRef}s, each rendering inside `raw` as its column: named the way
 * the dialect names it, so the naming strategy and `@Field({ name })` apply, and qualified by the alias
 * in scope. Metadata is read when a ref renders, so the map serves before the fields are registered.
 */
export function refs<E>(entity: Type<E>): RefMap<E> {
  return new Proxy({}, { get: (_, key) => columnRef(entity, String(key)) }) as RefMap<E>;
}

const MEMBER_REFS = new Proxy({}, { get: (_, key) => memberRef(String(key)) });

/**
 * The refs a definition's callbacks read: an index's, a check's, a computed field's. A member decorator
 * sees no class, so these name no entity and resolve against the one rendering them.
 */
export function memberRefs<E>(): ComputedRefs<E> {
  return MEMBER_REFS as ComputedRefs<E>;
}

/** SQL a definition writes, a callback's refs read off {@link memberRefs}. */
export function entitySql<E>(sql: EntitySql<E>): QueryRaw {
  return sql instanceof QueryRaw ? sql : sql(memberRefs<E>());
}

/** A definition's predicate, its callback resolved the way {@link entitySql} resolves one. */
export function entityWhere<E>(where: EntityWhere<E>): EntityWhereMeta<E> {
  return typeof where === 'function' ? where(memberRefs<E>()) : where;
}

/**
 * One member as a definition reads it: a {@link ColumnRef} where it names a field, and the same object
 * answering `count`, `sum`, `min`, `max` and `avg` where it names a to-many. One runtime object, since
 * a member decorator sees no class and so cannot know which the key is; the types keep them apart.
 */
function memberRef(relation: string): ColumnRef {
  const over = (op: Exclude<RelationAggregateOp, '$count'>) => (pick: PickedRef, q?: AggregatePage<object>) =>
    relationAggregate({ relation, op, field: pick(memberRefs<object>()).key, ...(q && { query: q }) });
  return Object.assign(columnRef(undefined, relation), {
    count: (q?: AggregatePage<object>) => relationAggregate({ relation, op: '$count', ...(q && { query: q }) }),
    sum: over('$sum'),
    min: over('$min'),
    max: over('$max'),
    avg: over('$avg'),
  });
}

/** A to-many aggregate's column, named by reading it off the target's refs: `(item) => item.amount`. */
type PickedRef = (refs: RefMap<object>) => ColumnRef;

/**
 * A relation aggregate as SQL: the dialect writes the same correlated subquery a `$count` reads,
 * correlated to whichever alias the clause naming the field is rendering under.
 */
function relationAggregate(spec: RelationAggregateSpec): RelationAggregate {
  return new RelationAggregate(spec, (opts) => {
    if (!opts.entity) {
      throw new TypeError(
        `'${spec.relation}' was read off a definition's refs, so it renders only inside its entity's SQL`,
      );
    }
    opts.dialect.appendRelationAggregate(opts.ctx, opts.entity, spec, opts.prefix);
  });
}

/** One field as SQL, against its own entity or, read off a definition, the entity rendering it. */
function columnRef(entity: Type<unknown> | undefined, key: string): ColumnRef {
  return new ColumnRef(key, (opts) => {
    const owner = entity ?? opts.entity;
    if (!owner) {
      throw new TypeError(`'${key}' was read off a definition's refs, so it renders only inside its entity's SQL`);
    }
    renderColumn(getMeta(owner), key, { ...opts, entity: owner });
  });
}

/** A field's column, or the expression an inlined computed one stands for, as a `$where` on it reads it. */
function renderColumn<E>(meta: EntityMeta<E>, key: string, opts: QueryRawRenderOptions): void {
  const field = meta.fields[key];
  if (field && isInlinedExpression(field)) {
    opts.ctx.append('(');
    field.computed.render(opts);
    opts.ctx.append(')');
    return;
  }
  opts.ctx.append(opts.escapedPrefix + opts.dialect.escapeId(opts.dialect.columnOf(meta, key), true));
}

/** A tag call passes the frozen strings array, which carries its own `raw` counterpart. */
function isTemplateStrings(value: unknown): value is TemplateStringsArray {
  return Array.isArray(value) && Array.isArray(Reflect.get(value, 'raw'));
}
