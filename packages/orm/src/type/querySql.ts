import type { QueryContext, RelationAggregateSpec, SqlQueryDialect, TriggerRows } from './dialect.js';
import type { Scalar, AbstractType } from './utility.js';

/** What a `sql` callback receives. See {@link QuerySqlFn}. */
export type QuerySqlRenderOptions = {
  /** The dialect rendering the SQL. */
  dialect: SqlQueryDialect;
  /** The alias of the table in scope, unescaped; empty where there is none. */
  prefix: string;
  /** {@link prefix} escaped, with its trailing dot. */
  escapedPrefix: string;
  /** The query context the SQL is written into. */
  ctx: QueryContext;
  /**
   * The entity being rendered, which a ref read off a definition's map resolves its column against: a
   * computed field's own, or the one whose schema is built. Absent where a statement renders SQL.
   */
  entity?: AbstractType<unknown>;
  /**
   * The rows a set-based trigger's writes read. Absent where the body reads `NEW` and `OLD` bare, and
   * outside a trigger.
   */
  rows?: TriggerRows;
};

/** {@link QuerySqlRenderOptions} as the callers along the way fill them in, every one still optional. */
export type QuerySqlFnOptions = Partial<QuerySqlRenderOptions>;

/**
 * A `sql` callback: write into `ctx`, or return a string or number to have it appended. Anything else
 * it returns is ignored, which is why the return type is `unknown` rather than `void | Scalar` - the
 * latter rejected `({ ctx }) => ctx.append(...)`, the form every computed field is written in, because
 * TypeScript's "returning a value where void is expected" allowance does not apply to a union.
 */
export type QuerySqlFn = (opts: QuerySqlRenderOptions) => unknown;

export const SQL_FN: unique symbol = Symbol('sqlFn');
export const RAW_ALIAS: unique symbol = Symbol('rawAlias');
export const SQL_TEXT: unique symbol = Symbol('sqlText');
/** Keys the phantom a ref or an aggregate carries its value type in, which no value ever fills. */
export const SQL_VALUE_TYPE: unique symbol = Symbol('sqlValueType');
/** The member a ref names. A symbol, as each of a ref's own keys is, so every string key is the data's. */
export const REF_KEY: unique symbol = Symbol('refKey');

/** The entity a {@link ColumnRef} was read off, where it names one: a definition's refs name none. */
export const REF_ENTITY: unique symbol = Symbol('refEntity');
/** The dotted path a {@link JsonPathRef} reads down its column's document. */
export const JSON_PATH: unique symbol = Symbol('jsonPath');
/** Keys the phantom a {@link JsonPathRef} carries the value at its path in. */
export const JSON_VALUE: unique symbol = Symbol('jsonValue');

/**
 * What a `sql` template interpolates: a value it binds, a list of them (`= ANY(${ids})`), or SQL it renders in
 * place. Never `undefined`, which would bind nothing: leave it out, or interpolate `null`.
 */
export type SqlArg = Scalar | null | readonly (Scalar | null)[] | QuerySql;

/** A statement as `all` and `run` take one: a tagged template's strings and values, or a `sql` built apart. */
export type SqlStatement = readonly [strings: TemplateStringsArray, ...values: SqlArg[]] | readonly [sql: QuerySql];

export class QuerySql {
  readonly [SQL_FN]: QuerySqlFn;
  readonly [RAW_ALIAS]?: string;
  /**
   * The SQL verbatim, set only where it is a constant: a template that interpolates nothing binds no
   * value and reads no column, so it needs no dialect to render. What a DDL clause with nowhere to
   * bind reads - see {@link constantSql}.
   */
  readonly [SQL_TEXT]?: string;

  constructor(value: QuerySqlFn, { alias, text }: { readonly alias?: string; readonly text?: string } = {}) {
    this[SQL_FN] = value;
    this[RAW_ALIAS] = alias;
    this[SQL_TEXT] = text;
  }

  /** The same expression under an alias, for a `$select` projection. */
  as(alias: string): QuerySql {
    return new QuerySql(this[SQL_FN], { alias, text: this[SQL_TEXT] });
  }
}

/** Writes `statement` into `opts.ctx`. The alias is the projection's to write, after the term. */
export function renderSql(statement: QuerySql, opts: QuerySqlRenderOptions): void {
  const emitted = statement[SQL_FN](opts);
  if (typeof emitted === 'string' || (typeof emitted === 'number' && !Number.isNaN(emitted))) {
    opts.ctx.append(String(emitted));
  }
}

/**
 * A field of an entity as SQL, read off `refs(Entity)` or a definition's refs: interpolated into `sql`, it
 * renders as the field's column. Its key is how an index tells a column from an expression, and `V`,
 * the field's type, is what a value slot checks it against: see {@link SqlFor}.
 */
export class ColumnRef<K extends string = string, V = unknown> extends QuerySql {
  declare readonly [SQL_VALUE_TYPE]?: V;
  readonly [REF_KEY]: K;
  readonly #entity?: () => AbstractType<unknown>;

  /** `entity` is read when the ref is, so an entity declared after the ref resolves. */
  constructor(key: K, value: QuerySqlFn, entity?: () => AbstractType<unknown>) {
    super(value);
    this[REF_KEY] = key;
    this.#entity = entity;
  }

  get [REF_ENTITY](): AbstractType<unknown> | undefined {
    return this.#entity?.();
  }
}

/**
 * A path inside a JSON column, read off an index's refs as the `$where` key it is: `user.settings.theme`
 * for `'settings.theme'`. `V`, the value at the path, decides how the index has to read it.
 */
export class JsonPathRef<V = unknown> {
  declare readonly [JSON_VALUE]?: V;
  readonly [REF_KEY]: string;
  readonly [JSON_PATH]: string;

  constructor(key: string, path: string) {
    this[REF_KEY] = key;
    this[JSON_PATH] = path;
  }
}

/**
 * SQL where a value of type `V` goes: bare SQL, whose type is its author's to know, or a ref to a column
 * holding one, nullability aside. `Sql` is what the transport carries, so the wire's `never` stays one.
 */
export type SqlFor<Sql, V> = Sql & { readonly [SQL_VALUE_TYPE]?: V | null };

/**
 * A relation aggregate as SQL, read off a `computed` field's refs: `(user) => user.resources.count()`.
 * It renders as the correlated subquery a `$count` reads, so a field holding one is read, filtered and
 * sorted like any other.
 *
 * `V` is the value it reads, carried in a phantom field so the aggregate a field declares decides the
 * property's type.
 */
export class RelationAggregate<V = unknown> extends QuerySql {
  declare readonly [SQL_VALUE_TYPE]?: V;

  constructor(
    /** What it reads, kept beside the SQL so a read decodes the value the way the target's field does. */
    readonly spec: RelationAggregateSpec,
    value: QuerySqlFn,
  ) {
    super(value);
  }
}

/**
 * A write `insertInto`, `updateTable` or `deleteFrom` renders, or several joined in one `sql`. It reads a
 * set-based trigger's rows through {@link QuerySqlRenderOptions.rows}, which is how `of` and `where` narrow
 * them there; SQL of its own reads `inserted` and `deleted` whole.
 */
export class TriggerWriteSql extends QuerySql {}
