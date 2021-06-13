import { QueryRaw } from '../type';

export class Raw implements QueryRaw {
  constructor(readonly value: string, readonly alias?: string) {}
}

export function raw(value: string, alias?: string): Raw {
  return new Raw(value, alias);
}
