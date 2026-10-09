import type { SelectTerm } from '../dialect/abstractSqlDialect.js';
import { DECODERS } from '../dialect/hydrateColumn.js';
import type { RawRow } from '../type/index.js';
import { isRecord } from '../util/index.js';

type Path = readonly string[];

/** Where a value sits in a nested row: the path to the object holding it, and its key there. */
type Slot = { readonly parent: Path; readonly key: string };

const TOP: Path = [];

const slotAt = (path: Path): Slot => ({ parent: path.slice(0, -1), key: path[path.length - 1] });

/**
 * How each row of one statement becomes the entity's, from the terms its SQL was written with: its dotted
 * columns nested, a joined row kept only where its key is, a to-many's rows read by their own terms, and each
 * value the driver leaves to the field decoded. Resolved once per statement, so a row pays for no discovery.
 */
export function rowReader<T>(terms: readonly SelectTerm[]): (row: RawRow) => T {
  const dotted = new Map<string, Path>();
  const joined: (Slot & { readonly idKey: string })[] = [];
  const mapped: (Slot & { readonly map: (value: unknown) => unknown })[] = [];
  for (const { key, kind, kinds, rows, joinedKey } of terms) {
    for (const [field, fieldKind] of kinds ?? []) {
      mapped.push({ parent: TOP, key: field, map: DECODERS[fieldKind] });
    }
    if (key === undefined) {
      continue;
    }
    const path = key.split('.');
    const slot = slotAt(path);
    if (path.length > 1) {
      dotted.set(key, path);
      if (joinedKey) {
        joined.push({ ...slotAt(slot.parent), idKey: slot.key });
      }
    }
    if (rows) {
      const read = rowReader(rows);
      mapped.push({ ...slot, map: (value) => (Array.isArray(value) ? value : JSON.parse(String(value))).map(read) });
    }
    if (kind) {
      mapped.push({ ...slot, map: DECODERS[kind] });
    }
  }
  const [firstDotted] = dotted.keys();

  return (raw) => {
    // All of a row's columns are flat or none is: SQL Server's `FOR JSON` nests a related row itself.
    const row = firstDotted !== undefined && firstDotted in raw ? nest(raw, dotted) : raw;
    for (const { parent, key, idKey } of joined) {
      const holder = holderAt(row, parent);
      const joinedRow = holder?.[key];
      if (holder && isRecord(joinedRow) && joinedRow[idKey] == null) {
        delete holder[key];
      }
    }
    for (const { parent, key, map } of mapped) {
      const holder = holderAt(row, parent);
      const value = holder?.[key];
      if (holder && value != null) {
        holder[key] = map(value);
      }
    }
    // A raw row becomes the entity here, as a parsed JSON value does: its shape is what the statement selected.
    return row as T;
  };
}

/** `row` with its dotted columns nested under the paths `dotted` names. */
function nest(row: RawRow, dotted: ReadonlyMap<string, Path>): RawRow {
  const nested: RawRow = {};
  for (const column in row) {
    const path = dotted.get(column);
    if (!path) {
      nested[column] = row[column];
      continue;
    }
    let target = nested;
    for (let i = 0; i < path.length - 1; i++) {
      const next = target[path[i]];
      target = isRecord(next) ? next : (target[path[i]] = {});
    }
    target[path[path.length - 1]] = row[column];
  }
  return nested;
}

/** The object at `path` in `row`, `row` itself for an empty one, if every step to it is one. */
function holderAt(row: RawRow, path: Path): RawRow | undefined {
  let target: RawRow = row;
  for (const step of path) {
    const next = target[step];
    if (!isRecord(next)) {
      return undefined;
    }
    target = next;
  }
  return target;
}
