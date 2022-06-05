import { QueryRaw, QueryRawFn, Scalar } from '../type/index';

export function raw(value: Scalar | QueryRawFn, alias?: string): QueryRaw {
  return new QueryRaw(value, alias);
}
