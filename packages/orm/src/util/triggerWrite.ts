import {
  type EntityPredicate,
  type QueryRaw,
  type TriggerWrite,
  TriggerWriteRaw,
  type Type,
  type UpdatePayload,
  type WritableKey,
  type WriteRow,
} from '../type/index.js';

/**
 * A row inserted by a trigger's body, into any table: `insertInto(PostAudit, { postId: newRow.id })`.
 * Each value is a literal or SQL, a row's ref most often, and every engine renders it, SQL Server's
 * set-based trigger included, where it inserts one row for each the statement touched.
 */
export function insertInto<E extends object>(entity: Type<E>, row: WriteRow<E>): QueryRaw {
  return written({ kind: 'insert', entity, row });
}

/** The rows `q.$where` names updated by a trigger's body: `updateTable(Post, { $where: { id: newRow.postId } }, set)`. */
export function updateTable<E extends object>(
  entity: Type<E>,
  q: { readonly $where: EntityPredicate<E> },
  set: UpdatePayload<E, QueryRaw, WritableKey<E>, never>,
): QueryRaw {
  return written({ kind: 'update', entity, set, where: q.$where });
}

/** The rows `q.$where` names deleted by a trigger's body, outright: a soft delete is an `updateTable`. */
export function deleteFrom<E extends object>(entity: Type<E>, q: { readonly $where: EntityPredicate<E> }): QueryRaw {
  return written({ kind: 'delete', entity, where: q.$where });
}

/** A write in a trigger's body, as every helper here and a stamp render one. */
export function written(write: TriggerWrite): QueryRaw {
  return new TriggerWriteRaw(({ ctx, dialect, rows }) => dialect.triggerWrite(ctx, write, rows));
}
