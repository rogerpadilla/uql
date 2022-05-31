import { QueryRaw, QueryRawFn, Scalar } from '@uql/core/type';

export function raw(value: Scalar | QueryRawFn, alias?: string): QueryRaw {
  return new QueryRaw(value, alias);
}
