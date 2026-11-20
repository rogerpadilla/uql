import type { EntityMeta, FieldMeta, RelationMeta } from '../../type/index.js';
import { UqlUsageError } from '../../util/uqlError.js';

/** The field `key` names, for a caller that took `key` from the metadata itself. */
export function fieldOf<E>(meta: EntityMeta<E>, key: string): FieldMeta {
  const field = meta.fields[key];
  if (!field) {
    throw new UqlUsageError(`'${meta.entity.name}' has no field '${key}'`);
  }
  return field;
}

/** The relation `key` names, for a caller that took `key` from the metadata itself. */
export function relationOf<E>(meta: EntityMeta<E>, key: string): RelationMeta {
  const relation = meta.relations[key];
  if (!relation) {
    throw new UqlUsageError(`'${meta.entity.name}' has no relation '${key}'`);
  }
  return relation;
}

/** Refuses to `act` on a plain view, which has no rows of its own. */
export function assertOwnRows<E>(meta: EntityMeta<E>, act: string): void {
  if (meta.view) {
    throw new UqlUsageError(`'${meta.entity.name}' is a plain view: it has no rows of its own to ${act}`);
  }
}
