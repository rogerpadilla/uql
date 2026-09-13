import type { QueryContext, QueryDialect } from './dialect.js';
import type { Type } from './utility.js';

/** What a `raw` callback receives. See {@link QueryRawFn}. */
export type QueryRawRenderOptions = {
  /** The dialect rendering the SQL. */
  dialect: QueryDialect;
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

export class QueryRaw {
  readonly [RAW_VALUE]: QueryRawFn;
  readonly [RAW_ALIAS]?: string;

  constructor(value: QueryRawFn, alias?: string) {
    this[RAW_VALUE] = value;
    this[RAW_ALIAS] = alias;
  }

  /** The same expression under an alias, for a `$select` projection. */
  as(alias: string): QueryRaw {
    return new QueryRaw(this[RAW_VALUE], alias);
  }

  /**
   * Emit this expression into `opts.ctx`. How a raw value becomes SQL is the raw value's own
   * business, which is what lets a `raw` tagged template resolve an interpolated fragment without
   * the dialect having to expose a method for it.
   *
   * The alias is not emitted here: it names a `$select` projection, which writes it after the term,
   * and anywhere else it would land mid-expression.
   */
  render(opts: QueryRawRenderOptions): void {
    const emitted = this[RAW_VALUE](opts);
    if (typeof emitted === 'string' || (typeof emitted === 'number' && !Number.isNaN(emitted))) {
      opts.ctx.append(String(emitted));
    }
  }
}
