import type { Change, ColumnChange, ColumnSchema, SchemaDiff } from '../type/index.js';

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

/** Each column `changes` make required on the rows already there: added so, or no longer nullable. */
export function newlyRequired(
  changes: readonly Change<ColumnSchema>[] = [],
): { readonly from?: ColumnSchema; readonly to: ColumnSchema }[] {
  return changes.flatMap(({ from, to }) => (to && !to.nullable && (!from || from.nullable) ? [{ from, to }] : []));
}

/** Whether a row already in the table would hold nothing in `column`: required, with no default, and not one the engine fills. */
export function lacksValue(column: ColumnSchema): boolean {
  return !column.nullable && column.defaultValue === undefined && !column.generatedAs && !column.isAutoIncrement;
}

/** Whether an engine that rebuilds tables makes `change` no other way: a column changed in place, or a stored generated one added. */
function onlyRebuilt({ from, to }: ColumnChange): boolean {
  return from === undefined ? Boolean(to?.generatedAs) : to !== undefined;
}

/** Whether `diff` holds anything an engine that rebuilds tables makes no other way, a key or a foreign key included. */
export function needsRebuild(diff: SchemaDiff): boolean {
  return Boolean(diff.primaryKey || diff.foreignKeys || diff.columns?.some(onlyRebuilt));
}

/** `diff` less its rebuild and everything only a rebuild makes: what an `ALTER` can still apply alone. */
export function withoutRebuild(diff: SchemaDiff): SchemaDiff {
  return {
    ...diff,
    primaryKey: undefined,
    foreignKeys: undefined,
    columns: nonEmpty((diff.columns ?? []).filter((change) => !onlyRebuilt(change))),
    rebuild: undefined,
  };
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
    rebuild: diff.rebuild && { from: diff.rebuild.to, to: diff.rebuild.from },
  };
}
