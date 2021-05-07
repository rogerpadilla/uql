import { getMeta } from '../entity/decorator/definition';

export function filterPersistableProperties<T>(type: { new (): T }, body: T): string[] {
  const meta = getMeta(type);
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
