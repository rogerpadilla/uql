import type { QueryContext, QueryDialect } from './dialect.js';
import type { Scalar } from './utility.js';

/**
 * options for the `raw` function.
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
 * a `raw` function
 */
export type QueryRawFn = (opts?: QueryRawFnOptions) => void | Scalar;

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
