import { getMeta } from '../entity/metadata/definition.js';
import {
  ColumnRef,
  type EntityMeta,
  type IndexRefMap,
  JSON_PATH,
  JsonPathRef,
  QuerySql,
  type QuerySqlFn,
  REF_KEY,
  renderSql,
  SQL_TEXT,
  type AggregatePage,
  type ComputedRefs,
  type QuerySqlRenderOptions,
  type RefMap,
  RelationAggregate,
  type RelationAggregateOp,
  type RelationAggregateSpec,
  type SqlArg,
  type SqlStatement,
  type SqlValueName,
  type TriggerRowName,
  TriggerWriteSql,
  type AbstractType,
} from '../type/index.js';
import { aggregateOf, isInlinedExpression } from './field.util.js';
import { entityName, hasKeys, isClass } from './object.util.js';
import { UqlUsageError } from './uqlError.js';

/**
 * Raw SQL, where an interpolated value binds, a `refs` field renders its column, and a `sql` renders
 * in place: `sql`GREATEST(0, ${user.credits} - ${amount})``. A callback writes whatever it writes, so
 * never build one from user input. See the Raw SQL guide.
 */
export function sql(strings: TemplateStringsArray, ...values: readonly SqlArg[]): QuerySql;
export function sql(value: QuerySqlFn): QuerySql;
export function sql(source: QuerySqlFn | TemplateStringsArray, ...values: readonly SqlArg[]): QuerySql {
  if (!isTemplateStrings(source)) {
    return new QuerySql(source);
  }
  if (!values.length) {
    return sql.text(source[0]);
  }
  if (values.some((value) => value === undefined)) {
    throw new UqlUsageError('an sql template interpolated undefined, which binds nothing: leave it out, or write null');
  }
  // Writes joined by whitespace alone are still only writes, so a set-based trigger narrows each one.
  const writes = values.every((value) => value instanceof TriggerWriteSql) && source.every((part) => !part.trim());
  return new (writes ? TriggerWriteSql : QuerySql)((opts) => {
    const { ctx } = opts;
    ctx.append(source[0]);
    values.forEach((value, i) => {
      if (value instanceof QuerySql) {
        renderSql(value, opts);
      } else {
        ctx.addValue(value);
      }
      ctx.append(source[i + 1]);
    });
  });
}

/** `parts` one after another, `separator` between each, every part binding its own values: `sql.join(conditions, ' AND ')`. */
sql.join = function join(parts: readonly QuerySql[], separator = ', '): QuerySql {
  return new QuerySql((opts) => {
    parts.forEach((part, index) => {
      if (index) {
        opts.ctx.append(separator);
      }
      renderSql(part, opts);
    });
  });
};

/**
 * A name the statement makes up, quoted as one identifier the way the dialect quotes one: a function's output, a
 * derived column, read twice from one constant, `AS ${reason} ... GROUP BY ${reason}`. An entity's names come off refs.
 */
sql.id = function id(name: string): QuerySql {
  return new QuerySql(({ dialect }) => dialect.escapeId(name, true));
};

/** SQL held in a string, run as written, binding nothing: for trusted text only, never built from user input. */
sql.text = function text(statement: string): QuerySql {
  return new QuerySql(() => statement, { text: statement });
};

/** The statement `all` or `run` was handed: a tagged template's, or a `sql` built apart. */
export function statementOf([statement, ...values]: SqlStatement): QuerySql {
  return statement instanceof QuerySql ? statement : sql(statement, ...values);
}

/**
 * The SQL of a `sql` that names a constant, for a DDL clause with no dialect to render against and
 * nowhere to bind a value; `undefined` where it interpolates and so needs one.
 */
export function constantSql(value: QuerySql): string | undefined {
  return value[SQL_TEXT];
}

/** A value the database computes, in each engine's SQL; one an engine has no function for throws. */
function sqlValue(name: SqlValueName): QuerySql {
  return sql(({ dialect }) => {
    const statement = dialect.sqlValues[name];
    if (statement === undefined) {
      throw new UqlUsageError(`${dialect.engineName} has no ${name}; write it as raw SQL this engine accepts`);
    }
    return statement;
  });
}

/**
 * The database's clock in UTC to the millisecond, the form uql reads a timestamp back in exactly. Use it for
 * a `defaultValue`, a stamp, an `onUpdate` or a `$where`, in entities and migrations alike.
 */
export const currentTimestamp: QuerySql = sqlValue('currentTimestamp');

/** Today on the database's clock; on SQLite, the text a bound `Date` at midnight is. */
export const currentDate: QuerySql = sqlValue('currentDate');

/** The time of day on the database's clock. */
export const currentTime: QuerySql = sqlValue('currentTime');

/** A UUID the database generates: a version 4, or a version 1 on MySQL and MariaDB. SQLite has none. */
export const uuid: QuerySql = sqlValue('uuid');

/** A time-ordered version 7 UUID, which indexes better as a key. Postgres 18+ and MariaDB 11.7+ only. */
export const uuidv7: QuerySql = sqlValue('uuidv7');

/** Each value above by its name, the name a migration or `generate:from-db` writes it under. */
export const SQL_VALUES: Readonly<Record<SqlValueName, QuerySql>> = {
  currentTimestamp,
  currentDate,
  currentTime,
  uuid,
  uuidv7,
};

/** An entity, or an arrow returning one, for an entity declared after the code reading it: `() => Order`. */
export type EntitySource<E> = AbstractType<E> | (() => AbstractType<E>);

function isThunk<E>(source: EntitySource<E>): source is () => AbstractType<E> {
  return !isClass(source);
}

/** `source` as what reads its entity when called. */
function resolverOf<E>(source: EntitySource<E>): () => AbstractType<E> {
  return isThunk(source) ? source : () => source;
}

/**
 * The fields of `entity` as {@link ColumnRef}s, each rendering inside `sql` as its column: named the way
 * the dialect names it, so the naming strategy and `.name()` apply, and qualified by `alias`, or else by the
 * alias in scope. The entity and its metadata are read when a ref renders, so `refs(() => Order)` serves code
 * running before `Order` is declared, a computed field's SQL included.
 */
export function refs<E>(entity: EntitySource<E>, alias?: string): RefMap<E> {
  const qualifier = alias === undefined ? undefined : { alias };
  const resolve = resolverOf(entity);
  return refMap<RefMap<E>>((key) => columnRef(resolve, key, qualifier), {
    table: () => tableSql(resolve, alias),
    alias: () => aliasSql(resolve, alias),
  });
}

/**
 * The table `source` names, an entity or the refs read off one under their alias, `"order" "o"`, for raw SQL
 * reading another table than its statement's: `sql`SELECT ${o.state} FROM ${tableOf(o)}``, `o = refs(Order, 'o')`.
 */
export function tableOf<E>(source: AbstractType<E> | RefMap<E>): QuerySql {
  return ownSql(source, TABLE, 'tableOf');
}

/**
 * The name `source`'s columns are qualified by, `"o"`, for raw SQL reading the whole row (`pdb.score(${aliasOf(o)})`)
 * or naming a derived table after it (`) ${aliasOf(o)} ON TRUE`): its alias, else the alias in scope, else its table.
 */
export function aliasOf<E>(source: AbstractType<E> | RefMap<E>): QuerySql {
  return ownSql(source, ALIAS, 'aliasOf');
}

/** What `source`'s refs keep under `key`, an entity's read as its unaliased refs; a definition's refs keep none. */
function ownSql<E>(source: AbstractType<E> | RefMap<E>, key: typeof TABLE | typeof ALIAS, caller: string): QuerySql {
  const own: unknown = Reflect.get(typeof source === 'function' ? refs(source) : source, key);
  if (!(own instanceof QuerySql)) {
    throw new UqlUsageError(`${caller} takes an entity or the refs() read off one, not a definition's refs`);
  }
  return own;
}

/** The table of the entity `resolve` reads, as its statements name it, under `alias` where one is given. */
function tableSql(resolve: () => AbstractType<unknown>, alias?: string): QuerySql {
  return sql(({ ctx, dialect }) => {
    ctx.append(dialect.tableRef(getMeta(resolve()), alias).ref);
  });
}

/** The name the columns of the entity `resolve` reads are qualified by: `alias`, else the alias in scope where it is that entity's, else its table. */
function aliasSql(resolve: () => AbstractType<unknown>, alias?: string): QuerySql {
  if (alias !== undefined) {
    return sql.id(alias);
  }
  return sql((opts) => {
    const owner = resolve();
    assertRendersIn(owner, opts);
    return opts.dialect.escapeId(opts.prefix || opts.dialect.tableRef(getMeta(owner)).alias, true);
  });
}

/** Where a refs map keeps its table and its alias, for {@link tableOf} and {@link aliasOf}: symbols, so no field can shadow them. */
const TABLE: unique symbol = Symbol('table');
const ALIAS: unique symbol = Symbol('alias');

/**
 * A map answering each string key with `ref(key)`, typed as the caller's map, whose keys say what it holds, and
 * {@link TABLE} and {@link ALIAS} with what renders its table and its alias where it reads one. No other symbol, so
 * nothing probing it sees more.
 */
function refMap<T>(
  ref: (key: string) => unknown,
  own?: { readonly table: () => QuerySql; readonly alias: () => QuerySql },
): T {
  return new Proxy(
    {},
    {
      get: (_, key) =>
        key === TABLE ? own?.table() : key === ALIAS ? own?.alias() : typeof key === 'string' ? ref(key) : undefined,
    },
  ) as T;
}

/**
 * The refs a definition's callbacks read: a check's, a computed field's, a predicate's. A member decorator
 * sees no class, so these name no entity and resolve against the one rendering them.
 */
export function memberRefs<E>(): ComputedRefs<E> {
  return refMap<ComputedRefs<E>>(memberRef);
}

/**
 * The refs an index's callbacks read: each field's column, a JSON one also read into along its paths,
 * `(user) => [user.settings.theme]`. Named for no entity, as {@link memberRefs} are.
 */
export function indexRefs<E>(): IndexRefMap<E> {
  return refMap<IndexRefMap<E>>((key) => readsPaths(columnRef(undefined, key)));
}

/** `ref`, where any string key it has not got of its own reads one key further down the column's document. */
function readsPaths<T extends ColumnRef | JsonPathRef>(ref: T): T {
  return new Proxy(ref, {
    get: (target, prop, receiver) => {
      if (typeof prop !== 'string' || prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      const path = target instanceof JsonPathRef ? `${target[JSON_PATH]}.${prop}` : prop;
      return readsPaths(new JsonPathRef(target[REF_KEY], path));
    },
  });
}

/**
 * One member as a definition reads it: a {@link ColumnRef} where it names a field, and the same object
 * answering `count`, `sum`, `min`, `max` and `avg` where it names a to-many. One runtime object, since
 * a member decorator sees no class and so cannot know which the key is; the types keep them apart.
 */
function memberRef(relation: string): ColumnRef {
  const over = (op: Exclude<RelationAggregateOp, '$count'>) => (pick: PickedRef, q?: AggregatePage<object>) =>
    relationAggregate({ relation, op, field: pick(memberRefs<object>())[REF_KEY], ...rowsOf(q) });
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
export function rowRefs<E>(entity: AbstractType<E>, row: TriggerRowName): RefMap<E> {
  return refMap<RefMap<E>>((key) => columnRef(entity, key, { row }));
}

/** What a ref reads its column off instead of the alias in scope: a trigger's row, `NEW` or `OLD`, or a table's alias. */
type Qualifier =
  | { readonly row: TriggerRowName; readonly alias?: never }
  | { readonly alias: string; readonly row?: never };

/**
 * One field as SQL, against its own entity or, read off a definition, the entity rendering it, read off the
 * alias in scope unless a `qualifier` names another.
 */
export function columnRef(entity: EntitySource<unknown> | undefined, key: string, qualifier?: Qualifier): ColumnRef {
  const resolve = entity && resolverOf(entity);
  return new ColumnRef(
    key,
    (opts) => {
      const owner = refOwner(resolve?.(), key, opts);
      if (!qualifier) {
        assertRendersIn(owner, opts);
      }
      renderColumn(getMeta(owner), key, { ...opts, entity: owner }, qualifier);
    },
    resolve,
  );
}

/** The entity a ref of `key` reads its column of: its own, or, read off a definition, the entity in scope. */
/** Refuses a ref of `owner` read off the alias in scope where that alias is another entity's. */
function assertRendersIn(
  owner: AbstractType<unknown>,
  { entity: scope }: { readonly entity?: AbstractType<unknown> },
): void {
  if (scope && scope !== owner && !(scope.prototype instanceof owner)) {
    throw new UqlUsageError(
      `a ref of '${owner.name}' cannot render against '${scope.name}', the table in scope: ` +
        `read it off its own alias, refs(${owner.name}, 'alias')`,
    );
  }
}

export function refOwner(
  entity: AbstractType<unknown> | undefined,
  key: string,
  scope: { readonly entity?: AbstractType<unknown> },
): AbstractType<unknown> {
  const owner = entity ?? scope.entity;
  if (!owner) {
    throw new UqlUsageError(`'${key}' was read off a definition's refs, so it renders only inside its entity's SQL`);
  }
  return owner;
}

/**
 * A field's column, or the expression an inlined computed one stands for, as a `$where` on it reads it.
 * Under a `qualifier` the column is read off that row or alias rather than off the alias in scope. A row is
 * written verbatim: it is a record the engine declares, not an identifier to quote and case-fold.
 */
function renderColumn<E>(meta: EntityMeta<E>, key: string, opts: QuerySqlRenderOptions, qualifier?: Qualifier): void {
  const scope = qualifier ? { ...opts, ...qualifiedBy(qualifier, opts) } : opts;
  const field = meta.fields[key];
  if (field && isInlinedExpression(field)) {
    // A relation aggregate is a subquery correlated to a table in scope, and a trigger's row is not one.
    if (qualifier?.row && aggregateOf(field)) {
      throw new UqlUsageError(
        `'${entityName(meta)}.${key}' reads a relation, which a trigger's row cannot: it fires on one row, ` +
          'with no table in scope to correlate a subquery to. Name the columns it is derived from instead.',
      );
    }
    renderSql(grouped(field.computed), scope);
    return;
  }
  scope.ctx.append(scope.escapedPrefix + scope.dialect.escapeId(scope.dialect.columnOf(meta, key), true));
}

/** The prefix a `qualifier` reads columns off, as the render options spell one. */
function qualifiedBy(
  { row, alias }: Qualifier,
  { dialect }: QuerySqlRenderOptions,
): Partial<Pick<QuerySqlRenderOptions, 'prefix' | 'escapedPrefix'>> {
  return row ? { escapedPrefix: `${row}.` } : { prefix: alias, escapedPrefix: dialect.escapeId(alias, true, true) };
}

/**
 * An inlined computed field's expression as every clause splices it: grouped, so a comparison inside cannot
 * chain with one around it (`a <= b = ?`). A relation aggregate is a subquery, grouped already.
 */
function grouped(computed: QuerySql): QuerySql {
  return computed instanceof RelationAggregate ? computed : sql`(${computed})`;
}

/** @deprecated Renamed to {@link sql}, the tag editors recognise for SQL highlighting. */
export const raw = sql;

/** A tag call passes the frozen strings array, which carries its own `sql` counterpart. */
function isTemplateStrings(value: unknown): value is TemplateStringsArray {
  return Array.isArray(value) && Array.isArray(Reflect.get(value, 'raw'));
}
