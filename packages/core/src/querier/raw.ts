import { QueryRaw, QueryRawFn } from '../type';

export class Raw implements QueryRaw {
  constructor(readonly value: string | QueryRawFn, readonly alias?: string) {}
}

export function raw(value: string | QueryRawFn, alias?: string): Raw {
  return new Raw(value, alias);
}
