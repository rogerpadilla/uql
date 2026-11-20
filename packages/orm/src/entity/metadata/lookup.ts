import type { EntityMeta, FieldMeta, RelationMeta, ViewMeta } from '../../type/index.js';
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

/** The view `meta` is read as, where it is a plain one: a materialized view and a table are read from their rows. */
export function queriedView<E>(meta: EntityMeta<E>): ViewMeta | undefined {
  return meta.view?.materialized ? undefined : meta.view;
}

/** The query a materialized view's table is refreshed from, refusing what is none. */
export function materializedView<E>(meta: EntityMeta<E>): ViewMeta {
  if (!meta.view?.materialized) {
    throw new UqlUsageError(`'${meta.entity.name}' is no materialized view: only one is refreshed`);
  }
  return meta.view;
}

/** Refuses to `act` on a plain view, which has no rows of its own. */
export function assertOwnRows<E>(meta: EntityMeta<E>, act: string): void {
  if (queriedView(meta)) {
    throw new UqlUsageError(`'${meta.entity.name}' is a plain view: it has no rows of its own to ${act}`);
  }
}
