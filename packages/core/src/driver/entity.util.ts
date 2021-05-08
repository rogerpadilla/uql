import { getMeta } from '../entity/decorator/definition';

export function filterPersistableProperties<E>(entity: { new (): E }, body: E): string[] {
  const meta = getMeta(entity);
  return Object.keys(body).filter((prop) => !!meta.properties[prop] && body[prop] !== undefined);
}
