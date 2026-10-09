import { getMeta } from '../entity/metadata/definition.js';
import {
  ColumnRef,
  type EntityMeta,
  type EntitySql,
  type EntityWhere,
  type EntityWhereMeta,
  QueryRaw,
  type QueryRawFn,
  RAW_TEXT,
  type AggregatePage,
  type ComputedRefs,
  type QueryRawRenderOptions,
  type RefMap,
  RelationAggregate,
  type RelationAggregateOp,
  type RelationAggregateSpec,
  type RawValue,
  type SqlStatement,
  type SqlValueName,
  type TriggerRowName,
  TriggerWriteRaw,
  type Type,
} from '../type/index.js';
import { aggregateOf, isInlinedExpression } from './field.util.js';
import { entityName, hasKeys } from './object.util.js';
import { UqlUsageError } from './uqlError.js';

/**
 * Raw SQL, where an interpolated value binds, a `refs` field renders its column, and a `raw` renders
 * in place: `raw`GREATEST(0, ${user.credits} - ${amount})``. A callback writes whatever it writes, so
 * never build one from user input. See the Raw SQL guide.
 */
export function raw(strings: TemplateStringsArray, ...values: readonly RawValue[]): QueryRaw;
export function raw(value: QueryRawFn): QueryRaw;
export function raw(source: QueryRawFn | TemplateStringsArray, ...values: readonly RawValue[]): QueryRaw {
  if (!isTemplateStrings(source)) {
    return new QueryRaw(source);
  }
  if (!values.length) {
    return raw.text(source[0]);
  }
  if (values.some((value) => value === undefined)) {
    throw new UqlUsageError('a raw template interpolated undefined, which binds nothing: leave it out, or write null');
  }
  // Writes joined by whitespace alone are still only writes, so a set-based trigger narrows each one.
  const writes = values.every((value) => value instanceof TriggerWriteRaw) && source.every((part) => !part.trim());
  return new (writes ? TriggerWriteRaw : QueryRaw)((opts) => {
    const { ctx } = opts;
    ctx.append(source[0]);
    values.forEach((value, i) => {
      if (value instanceof QueryRaw) {
        value.render(opts);
      } else {
        ctx.addValue(value);
      }
      ctx.append(source[i + 1]);
    });
  });
}

/** `parts` one after another, `separator` between each, every part binding its own values: `raw.join(conditions, ' AND ')`. */
raw.join = function join(parts: readonly QueryRaw[], separator = ', '): QueryRaw {
  return new QueryRaw((opts) => {
    parts.forEach((part, index) => {
      if (index) {
        opts.ctx.append(separator);
      }
      part.render(opts);
    });
  });
};

/** SQL held in a string, run as written, binding nothing: for trusted text only, never built from user input. */
raw.text = function text(sql: string): QueryRaw {
  return new QueryRaw(() => sql, { text: sql });
};

/** The statement `all` or `run` was handed: a tagged template's, or a `raw` built apart. */
export function statementOf([sql, ...values]: SqlStatement): QueryRaw {
  return sql instanceof QueryRaw ? sql : raw(sql, ...values);
}

/**
 * The SQL of a `raw` that names a constant, for a DDL clause with no dialect to render against and
 * nowhere to bind a value; `undefined` where it interpolates and so needs one.
 */
export function constantSql(value: QueryRaw): string | undefined {
  return value[RAW_TEXT];
}

/** A value the database computes, in each engine's SQL; one an engine has no function for throws. */
function sqlValue(name: SqlValueName): QueryRaw {
  return raw(({ dialect }) => {
    const sql = dialect.sqlValues[name];
    if (sql === undefined) {
      throw new UqlUsageError(`${dialect.dialectName} has no ${name}; write it as raw SQL this engine accepts`);
    }
    return sql;
  });
}

/**
 * The database's clock in UTC to the millisecond, the form uql reads a timestamp back in exactly. Use it for
 * a `defaultValue`, a stamp, an `onUpdate` or a `$where`, in entities and migrations alike.
 */
export const currentTimestamp: QueryRaw = sqlValue('currentTimestamp');

/** Today on the database's clock; on SQLite, the text a bound `Date` at midnight is. */
export const currentDate: QueryRaw = sqlValue('currentDate');

/** The time of day on the database's clock. */
export const currentTime: QueryRaw = sqlValue('currentTime');

/** A UUID the database generates: a version 4, or a version 1 on MySQL and MariaDB. SQLite has none. */
export const uuid: QueryRaw = sqlValue('uuid');

/** A time-ordered version 7 UUID, which indexes better as a key. Postgres 18+ and MariaDB 11.7+ only. */
export const uuidv7: QueryRaw = sqlValue('uuidv7');

/** Each value above by its name, the name a migration or `generate:from-db` writes it under. */
export const SQL_VALUES: Readonly<Record<SqlValueName, QueryRaw>> = {
  currentTimestamp,
  currentDate,
  currentTime,
  uuid,
  uuidv7,
};

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
    relationAggregate({ relation, op, field: pick(memberRefs<object>()).key, ...rowsOf(q) });
  return Object.assign(columnRef(undefined, relation), {
    count: (q?: AggregatePage<object>) => relationAggregate({ relation, op: '$count', ...rowsOf(q) }),
    sum: over('$sum'),
    min: over('$min'),
    max: over('$max'),
    avg: over('$avg'),
  });
}

/** The rows an aggregate's declared query reads: its `$where`, and the page the rest of it caps them to. */
function rowsOf(q: AggregatePage<object> | undefined): Pick<RelationAggregateSpec, 'where' | 'page'> {
  const { $where, ...page } = q ?? {};
  return { ...($where && { where: $where }), ...(hasKeys(page) && { page }) };
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
      throw new UqlUsageError(
        `'${spec.relation}' was read off a definition's refs, so it renders only inside its entity's SQL`,
      );
    }
    opts.dialect.appendRelationAggregate(opts.ctx, opts.entity, spec, opts.prefix);
  });
}

/**
 * The fields of `entity` as the row a trigger body reads them off, qualified by the side it names:
 * `NEW."col"` against the incoming row, `OLD."col"` against the outgoing one. Bound to the entity, as
 * {@link refs} are, so each names its own column wherever it renders, a write to another table included.
 * Columns only: a relation's aggregate is a subquery, and a trigger fires on one row, not over a table.
 */
export function rowRefs<E>(entity: Type<E>, qualifier: TriggerRowName): RefMap<E> {
  return new Proxy({}, { get: (_, key) => columnRef(entity, String(key), qualifier) }) as RefMap<E>;
}

/**
 * One field as SQL, against its own entity or, read off a definition, the entity rendering it. A
 * `qualifier` names the row it reads from, `NEW` or `OLD`, instead of the alias in scope.
 */
function columnRef(entity: Type<unknown> | undefined, key: string, qualifier?: string): ColumnRef {
  return new ColumnRef(key, (opts) => {
    const owner = entity ?? opts.entity;
    if (!owner) {
      throw new UqlUsageError(`'${key}' was read off a definition's refs, so it renders only inside its entity's SQL`);
    }
    renderColumn(getMeta(owner), key, { ...opts, entity: owner }, qualifier);
  });
}

/**
 * A field's column, or the expression an inlined computed one stands for, as a `$where` on it reads it.
 * Under a `qualifier` the column is read off that row rather than off the alias in scope, and the row is
 * written verbatim: it is a record the engine declares, not an identifier to quote and case-fold.
 */
function renderColumn<E>(meta: EntityMeta<E>, key: string, opts: QueryRawRenderOptions, qualifier?: string): void {
  const scope = qualifier === undefined ? opts : { ...opts, escapedPrefix: `${qualifier}.` };
  const field = meta.fields[key];
  if (field && isInlinedExpression(field)) {
    // A relation aggregate is a subquery correlated to a table in scope, and a trigger's row is not one.
    if (qualifier !== undefined && aggregateOf(field)) {
      throw new UqlUsageError(
        `'${entityName(meta)}.${key}' reads a relation, which a trigger's row cannot: it fires on one row, ` +
          'with no table in scope to correlate a subquery to. Name the columns it is derived from instead.',
      );
    }
    scope.ctx.append('(');
    field.computed.render(scope);
    scope.ctx.append(')');
    return;
  }
  scope.ctx.append(scope.escapedPrefix + scope.dialect.escapeId(scope.dialect.columnOf(meta, key), true));
}

/** A tag call passes the frozen strings array, which carries its own `raw` counterpart. */
function isTemplateStrings(value: unknown): value is TemplateStringsArray {
  return Array.isArray(value) && Array.isArray(Reflect.get(value, 'raw'));
}
