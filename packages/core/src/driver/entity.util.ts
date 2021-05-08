import { getMeta } from '../entity/decorator/definition';

export function filterPersistableProperties<E>(entity: { new (): E }, body: E): string[] {
  const meta = getMeta(entity);
  return Object.keys(body).filter((prop) => {
    const isProperty = !!meta.properties[prop];
    const value = body[prop];
    const relationOpts = meta.relations[prop];
    return (
      isProperty &&
      value !== undefined &&
      // 'manyToOne' is the only relation which doesn't require additional stuff when saving
      (!relationOpts || relationOpts.cardinality === 'manyToOne')
    );
  });
}
