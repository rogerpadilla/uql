import {
  type EntityPredicate,
  type QueryUpsert,
  type QuerySql,
  type TriggerWrite,
  TriggerWriteSql,
  type AbstractType,
  type UpdatePayload,
  type WritableKey,
  type WriteRow,
} from '../type/index.js';

/**
 * A row inserted by a trigger's body, into any table: `insertInto(PostAudit, { postId: newRow.id })`.
 * Each value is a literal or SQL, a row's ref most often, and every engine renders it, SQL Server's
 * set-based trigger included, where it inserts one row for each the statement touched.
 */
export function insertInto<E extends object>(entity: AbstractType<E>, row: WriteRow<E>): QuerySql {
  return written({ kind: 'insert', entity, row });
}

/**
 * An upsert's query as a trigger's body writes it: its `$update` sets columns only, no relation, and its `$where`
 * reads the found row's own columns, with no relation to filter by.
 */
export type TriggerUpsert<E> = QueryUpsert<E, QuerySql, UpdatePayload<E, QuerySql, WritableKey<E>, never>> & {
  readonly $where?: EntityPredicate<E>;
};

/**
 * A row inserted by a trigger's body, or what `q.$conflict` finds taking `q.$update` instead where it matches
 * `q.$where`, as `upsertOne` does: `upsertInto(Tally, { $conflict: { postId: true }, $update: { count: { $inc: 1 } } },
 * { postId: newRow.id, count: 1 })`.
 */
export function upsertInto<E extends object>(entity: AbstractType<E>, q: TriggerUpsert<E>, row: WriteRow<E>): QuerySql {
  return written({ kind: 'upsert', entity, q, row });
}

/** The rows `q.$where` names updated by a trigger's body: `updateTable(Post, { $where: { id: newRow.postId } }, set)`. */
export function updateTable<E extends object>(
  entity: AbstractType<E>,
  q: { readonly $where: EntityPredicate<E> },
  set: UpdatePayload<E, QuerySql, WritableKey<E>, never>,
): QuerySql {
  return written({ kind: 'update', entity, set, where: q.$where });
}

/** The rows `q.$where` names deleted by a trigger's body, outright: a soft delete is an `updateTable`. */
export function deleteFrom<E extends object>(
  entity: AbstractType<E>,
  q: { readonly $where: EntityPredicate<E> },
): QuerySql {
  return written({ kind: 'delete', entity, where: q.$where });
}

/**
 * Fails the write that fired the trigger, with `message` as the error: a table kept append-only refuses its
 * updates and deletes, and a `where` narrows it to the rows a rule forbids.
 */
export function refuse(message: string): QuerySql {
  return written({ kind: 'refuse', message });
}

/** A write in a trigger's body, as every helper here and a stamp render one. */
export function written(write: TriggerWrite): QuerySql {
  return new TriggerWriteSql(({ ctx, dialect, rows }) => dialect.triggerWrite(ctx, write, rows));
}
