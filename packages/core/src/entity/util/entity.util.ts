import { Type } from '@uql/core/type';
import { objectKeys } from '@uql/core/util';
import { getMeta } from '../decorator/definition';

export function filterPersistableProperties<E>(entity: Type<E>, payload: E): string[] {
  const meta = getMeta(entity);
  return objectKeys(payload).filter((prop) => meta.properties[prop] && payload[prop] !== undefined);
}
