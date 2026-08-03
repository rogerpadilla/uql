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
 * A `raw` callback. `Required`, and the parameter not optional, because the one place that calls it
 * (`getRawValue`) passes all four every time: declaring them optional made `({ ctx }) => ctx.append(...)`
 * - the form every virtual field is written in - not compile without a default or a `!`.
 */
export type QueryRawFn = (opts: Required<QueryRawFnOptions>) => void | Scalar;

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
