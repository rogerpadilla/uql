import { Type } from '@uql/core/type';
import { getMeta } from '../decorator/definition';

export function filterPersistableProperties<E>(entity: Type<E>, payload: E): string[] {
  const meta = getMeta(entity);
  return Object.keys(payload).filter((prop) => !!meta.properties[prop] && payload[prop] !== undefined);
}
