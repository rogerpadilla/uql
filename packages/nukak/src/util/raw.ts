import { QueryRaw, QueryRawFn, Scalar } from '../type/index.js';

/**
 * Allow using any raw value that shouldn't be automatically escaped by the ORM.
 * @param value the raw value
 * @param alias optional alias
 * @returns a QueryRaw instance
 */
export function raw(value: Scalar | QueryRawFn, alias?: string): any {
  return new QueryRaw(value, alias);
}
