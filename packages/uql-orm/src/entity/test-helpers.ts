import type { EntityMeta, Type } from '../type/index.js';
import { getMeta } from './metadata/definition.js';

/** Stable projection for parity assertions (drops `entity` and `processed`). */
export function metaCore<E>(
  entity: Type<E>,
): Pick<EntityMeta<E>, 'id' | 'name' | 'fields' | 'relations' | 'indexes' | 'hooks' | 'softDelete'> {
  const m = getMeta(entity);
  return {
    id: m.id,
    name: m.name,
    fields: m.fields,
    relations: m.relations,
    indexes: m.indexes,
    hooks: m.hooks,
    softDelete: m.softDelete,
  };
}
