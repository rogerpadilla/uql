import { getMeta } from '../entity/metadata/definition.js';
import {
  ColumnRef,
  type EntityMeta,
  type EntitySql,
  type EntityWhere,
  type EntityWhereMeta,
  QueryRaw,
  type QueryRawFn,
  type QueryRawRenderOptions,
  type RefMap,
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

const MEMBER_REFS = new Proxy({}, { get: (_, key) => columnRef(undefined, String(key)) });

/**
 * The refs a definition's callbacks read: an index's, a check's, a computed field's. A member decorator
 * sees no class, so these name no entity and resolve against the one rendering them.
 */
export function memberRefs<E>(): RefMap<E> {
  return MEMBER_REFS as RefMap<E>;
}

/** SQL a definition writes, a callback's refs read off {@link memberRefs}. */
export function entitySql<E>(sql: EntitySql<E>): QueryRaw {
  return sql instanceof QueryRaw ? sql : sql(memberRefs<E>());
}

/** A definition's predicate, its callback resolved the way {@link entitySql} resolves one. */
export function entityWhere<E>(where: EntityWhere<E>): EntityWhereMeta<E> {
  return typeof where === 'function' ? where(memberRefs<E>()) : where;
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
