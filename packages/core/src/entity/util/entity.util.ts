import { Type } from '@uql/core/type';
import { getMeta } from '../decorator/definition';

export function filterPersistableProperties<E>(entity: Type<E>, body: E): string[] {
  const meta = getMeta(entity);
  return Object.keys(body).filter((prop) => !!meta.properties[prop] && body[prop] !== undefined);
}
