import { QueryRaw, QueryRawFn, Scalar } from '../type';

export class Raw implements QueryRaw {
  constructor(readonly value: Scalar | QueryRawFn, readonly alias?: string) {}
}

export function raw(value: Scalar | QueryRawFn, alias?: string): Raw {
  return new Raw(value, alias);
}
