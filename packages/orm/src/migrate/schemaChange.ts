import type { Change, SchemaDiff } from '../type/index.js';

/** Each change's end on `side`, where it has one: what a drop half removes (`from`), or an add half creates (`to`). */
export function sides<T>(changes: readonly Change<T>[] | undefined, side: 'from' | 'to'): T[] {
  return (changes ?? []).flatMap((change) => {
    const end = change[side];
    return end === undefined ? [] : [end];
  });
}

/** What the changes add: each `to` with no `from`. */
export function added<T>(changes: readonly Change<T>[] = []): T[] {
  return changes.flatMap(({ from, to }) => (from === undefined && to !== undefined ? [to] : []));
}

/** What the changes drop: each `from` with no `to`. */
export function dropped<T>(changes: readonly Change<T>[] = []): T[] {
  return changes.flatMap(({ from, to }) => (to === undefined && from !== undefined ? [from] : []));
}

/** The changes that alter an object in place, which only a column can. */
export function alterations<T>(changes: readonly Change<T>[] = []): { readonly from: T; readonly to: T }[] {
  return changes.flatMap(({ from, to }) => (from === undefined || to === undefined ? [] : [{ from, to }]));
}

/** `items`, or nothing where it has none, so an empty change list is left off a diff. */
export function nonEmpty<T>(items: readonly T[]): readonly T[] | undefined {
  return items.length ? items : undefined;
}

/** `change` undone: an add becomes a drop, a drop an add, and an alter runs the other way. */
export function swap<T>({ from, to }: Change<T>): Change<T> {
  return { from: to, to: from };
}

/** `diff` undone: every change swapped, which is what a migration's `down` runs. */
export function reverseDiff(diff: SchemaDiff): SchemaDiff {
  return {
    ...diff,
    primaryKey: diff.primaryKey && swap(diff.primaryKey),
    columns: diff.columns?.map(swap),
    indexes: diff.indexes?.map(swap),
    foreignKeys: diff.foreignKeys?.map(swap),
    renamedColumns: diff.renamedColumns?.map(({ from, to }) => ({ from: to, to: from })),
  };
}
