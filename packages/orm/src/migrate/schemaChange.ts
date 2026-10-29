import type { Alteration, Change, ColumnChange, ColumnSchema, IndexEntry, SchemaDiff } from '../type/index.js';
import { lacksValue } from '../util/field.util.js';
import { renamedEntry } from '../util/indexEntry.util.js';

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
export function alterations<T>(changes: readonly Change<T>[] = []): Alteration<T>[] {
  return changes.flatMap(({ from, to }) => (from === undefined || to === undefined ? [] : [{ from, to }]));
}

/** Each column `changes` make required on the rows already there: added so, or no longer nullable. */
export function newlyRequired(
  changes: readonly Change<ColumnSchema>[] = [],
): { readonly from?: ColumnSchema; readonly to: ColumnSchema }[] {
  return changes.flatMap(({ from, to }) => (to && !to.nullable && (!from || from.nullable) ? [{ from, to }] : []));
}

/** Whether an engine that rebuilds tables makes `change` no other way: a column changed in place, or a stored generated one added. */
function onlyRebuilt({ from, to }: ColumnChange): boolean {
  return from === undefined ? Boolean(to?.generatedAs) : to !== undefined;
}

/** Whether `diff` holds anything an engine that rebuilds tables makes no other way: a key, a foreign key or a check included. */
export function needsRebuild(diff: SchemaDiff): boolean {
  return Boolean(diff.primaryKey || diff.foreignKeys || diff.checks || diff.columns?.some(onlyRebuilt));
}

/** `diff` less its rebuild and everything only a rebuild makes: what an `ALTER` can still apply alone. */
export function withoutRebuild(diff: SchemaDiff): SchemaDiff {
  return {
    ...diff,
    primaryKey: undefined,
    foreignKeys: undefined,
    checks: undefined,
    columns: nonEmpty((diff.columns ?? []).filter((change) => !onlyRebuilt(change))),
    rebuild: undefined,
  };
}

/**
 * The columns `diff` drops that its rollback puts back nullable: required, with nothing to fill the rows. A
 * rebuild restores its table verbatim instead.
 */
export function unfillableRestores(diff: SchemaDiff): ColumnSchema[] {
  return diff.rebuild ? [] : dropped(diff.columns).filter(lacksValue);
}

/**
 * `diff` as a rollback runs it: reversed, its {@link unfillableRestores} put back nullable, since no engine
 * adds a required column to rows holding none.
 */
export function rollbackDiff(diff: SchemaDiff): SchemaDiff {
  const unfillable = new Set(unfillableRestores(diff));
  const reversed = reverseDiff(diff);
  const columns = reversed.columns?.map((change) =>
    change.to && unfillable.has(change.to) ? { ...change, to: { ...change.to, nullable: true } } : change,
  );
  return { ...reversed, columns };
}

/** `items`, or nothing where it has none, so an empty change list is left off a diff. */
export function nonEmpty<T>(items: readonly T[]): readonly T[] | undefined {
  return items.length ? items : undefined;
}

/** `change` undone: an add becomes a drop, a drop an add, and an alter runs the other way. */
function swap<T>({ from, to }: Change<T>): Change<T> {
  return { from: to, to: from };
}

/**
 * `diff` undone: every change swapped, which is what a migration's `down` runs. Renames run before the adds
 * either way, so a key, index or foreign key put back names a renamed column as the rename back leaves it.
 */
export function reverseDiff(diff: SchemaDiff): SchemaDiff {
  const renamedColumns = diff.renamedColumns?.map(({ from, to }) => ({ from: to, to: from }));
  const renamed = new Map(renamedColumns?.map(({ from, to }) => [from, to]));
  const nameOf = (column: string) => renamed.get(column) ?? column;
  return {
    ...diff,
    primaryKey: diff.primaryKey && putBack(diff.primaryKey, (key) => ({ ...key, columns: key.columns.map(nameOf) })),
    columns: diff.columns?.map(swap),
    indexes: diff.indexes?.map((change) =>
      putBack(change, (index) => ({ ...index, entries: renameIndexEntries(index.entries, nameOf) })),
    ),
    foreignKeys: diff.foreignKeys?.map((change) =>
      putBack(change, (foreignKey) => ({ ...foreignKey, columns: foreignKey.columns.map(nameOf) })),
    ),
    checks: diff.checks?.map(swap),
    triggers: diff.triggers?.map(swap),
    renamedColumns,
    rebuild: diff.rebuild && { from: diff.rebuild.to, to: diff.rebuild.from },
  };
}

/** `change` swapped, what it puts back passed through `restore`. */
function putBack<T>({ from, to }: Change<T>, restore: (it: T) => T): Change<T> {
  return { from: to, to: from && restore(from) };
}

/** Each entry's column named by `nameOf`; an expression entry is SQL, left as written. */
export function renameIndexEntries(
  entries: readonly IndexEntry<string>[],
  nameOf: (column: string) => string,
): IndexEntry<string>[] {
  return entries.map((entry) => renamedEntry(entry, nameOf));
}
