import type { QueryContext, QueryDialect } from './dialect.js';
import type { Scalar } from './utility.js';

/**
 * What may be passed towards a `raw` callback. Every key is optional here because the callers along the
 * way fill them in progressively; what reaches the callback is the complete set - see {@link QueryRawFn}.
 */
export type QueryRawFnOptions = {
  /**
   * the current dialect.
   */
  dialect?: QueryDialect;
  /**
   * the prefix.
   */
  prefix?: string;
  /**
   * the escaped prefix.
   */
  escapedPrefix?: string;
  /**
   * the query context.
   */
  ctx?: QueryContext;
};

/**
 * A `raw` callback: write into `ctx`, or return a string or number to have it appended. Anything else
 * it returns is ignored, which is why the return type is `unknown` rather than `void | Scalar` - the
 * latter rejected `({ ctx }) => ctx.append(...)`, the form every virtual field is written in, because
 * TypeScript's "returning a value where void is expected" allowance does not apply to a union.
 *
 * `Required`, and the parameter not optional, because the one place that calls it (`getRawValue`)
 * passes all four every time.
 */
export type QueryRawFn = (opts: Required<QueryRawFnOptions>) => unknown;

export const RAW_VALUE: unique symbol = Symbol('rawValue');
export const RAW_ALIAS: unique symbol = Symbol('rawAlias');

export class QueryRaw {
  readonly [RAW_VALUE]: Scalar | QueryRawFn;
  readonly [RAW_ALIAS]?: string;

  constructor(value: Scalar | QueryRawFn, alias?: string) {
    this[RAW_VALUE] = value;
    this[RAW_ALIAS] = alias;
  }
}
