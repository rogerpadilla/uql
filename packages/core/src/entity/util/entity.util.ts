import { Type } from '@uql/core/type';
import { getKeys } from '@uql/core/util';
import { getMeta } from '../decorator/definition';

export function filterPersistableProperties<E>(entity: Type<E>, payload: E): string[] {
  const meta = getMeta(entity);
  return getKeys(payload).filter((prop) => meta.properties[prop] && payload[prop] !== undefined);
}
