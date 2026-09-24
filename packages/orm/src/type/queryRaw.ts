import type { QueryContext, RelationAggregateSpec, SqlQueryDialect } from './dialect.js';
import type { Type } from './utility.js';

/** What a `raw` callback receives. See {@link QueryRawFn}. */
export type QueryRawRenderOptions = {
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
  entity?: Type<unknown>;
  /**
   * The `FROM` a set-based trigger's body reads its rows through, `FROM inserted` and the like, which a
   * write in it names. Absent where the body reads `NEW` and `OLD` bare, and outside a trigger.
   */
  rows?: string;
};

/** {@link QueryRawRenderOptions} as the callers along the way fill them in, every one still optional. */
export type QueryRawFnOptions = Partial<QueryRawRenderOptions>;

/**
 * A `raw` callback: write into `ctx`, or return a string or number to have it appended. Anything else
 * it returns is ignored, which is why the return type is `unknown` rather than `void | Scalar` - the
 * latter rejected `({ ctx }) => ctx.append(...)`, the form every computed field is written in, because
 * TypeScript's "returning a value where void is expected" allowance does not apply to a union.
 */
export type QueryRawFn = (opts: QueryRawRenderOptions) => unknown;

export const RAW_VALUE: unique symbol = Symbol('rawValue');
export const RAW_ALIAS: unique symbol = Symbol('rawAlias');
export const RAW_TEXT: unique symbol = Symbol('rawText');

export class QueryRaw {
  readonly [RAW_VALUE]: QueryRawFn;
  readonly [RAW_ALIAS]?: string;
  /**
   * The SQL verbatim, set only where it is a constant: a template that interpolates nothing binds no
   * value and reads no column, so it needs no dialect to render. What a DDL clause with nowhere to
   * bind reads - see {@link constantSql}.
   */
  readonly [RAW_TEXT]?: string;

  constructor(value: QueryRawFn, alias?: string, text?: string) {
    this[RAW_VALUE] = value;
    this[RAW_ALIAS] = alias;
    this[RAW_TEXT] = text;
  }

  /** The same expression under an alias, for a `$select` projection. */
  as(alias: string): QueryRaw {
    return new QueryRaw(this[RAW_VALUE], alias, this[RAW_TEXT]);
  }

  /** Writes the expression into `opts.ctx`. The alias is the projection's to write, after the term. */
  render(opts: QueryRawRenderOptions): void {
    const emitted = this[RAW_VALUE](opts);
    if (typeof emitted === 'string' || (typeof emitted === 'number' && !Number.isNaN(emitted))) {
      opts.ctx.append(String(emitted));
    }
  }
}

/**
 * A field of an entity as SQL, read off `refs(Entity)` or a definition's refs: interpolated into `raw`, it
 * renders as the field's column. Its `key` is how an index tells a column from an expression, and `V`,
 * the field's type, is what a value slot checks it against: see {@link RawFor}.
 */
export class ColumnRef<K extends string = string, V = unknown> extends QueryRaw {
  declare readonly __value?: V;

  constructor(
    readonly key: K,
    value: QueryRawFn,
  ) {
    super(value);
  }
}

/**
 * SQL where a value of type `V` goes: bare SQL, whose type is its author's to know, or a ref to a column
 * holding one, nullability aside. `Raw` is what the transport carries, so the wire's `never` stays one.
 */
export type RawFor<Raw, V> = Raw & { readonly __value?: V | null };

/**
 * A relation aggregate as SQL, read off a `computed` field's refs: `(user) => user.resources.count()`.
 * It renders as the correlated subquery a `$count` reads, so a field holding one is read, filtered and
 * sorted like any other.
 *
 * `V` is the value it reads and `Storable` whether a trigger could keep it, both carried in phantom
 * fields so the aggregate a field declares decides the property's type and refuses `stored: true` on
 * one no delta can maintain.
 */
export class RelationAggregate<V = unknown, Storable extends boolean = boolean> extends QueryRaw {
  declare readonly __value?: V;
  declare private readonly __storable: Storable;

  constructor(
    /** What it reads, kept beside the SQL so a read decodes the value the way the target's field does. */
    readonly spec: RelationAggregateSpec,
    value: QueryRawFn,
  ) {
    super(value);
  }
}
