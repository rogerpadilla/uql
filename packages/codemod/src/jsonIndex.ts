import ts from 'typescript';
import type { Context } from './context.js';
import { type Edit, original, type Part, replaced } from './edits.js';
import { memberAccess } from './keyMaps.js';
import {
  arrayElements,
  columnListEntries,
  namedProperty,
  propertyAssignment,
  propertyKey,
  propertyValue,
} from './syntax.js';

/** The entry's own keys the rewritten entry writes itself rather than carrying over. */
const MOVED_KEYS: ReadonlySet<string | undefined> = new Set(['column', 'length']);

type JsonRead = { readonly keys: string[]; readonly type: ts.Expression; readonly length?: ts.Expression };

/**
 * Rewrites each JSON entry of an index's columns into the path read off the column's ref, as a `$where` key
 * spells it: `{ column: post.kind, jsonPath: { path: 'theme.color', type: String } }` becomes
 * `{ column: post.kind.theme.color, type: String }`, and a `jsonArray`'s element type becomes `type: [String]`.
 * Its `length` becomes `charLength`, and a column entry's becomes `prefixLength`.
 */
export function rewriteJsonIndexEntries(columns: ts.Expression | undefined, ctx: Context): void {
  for (const entry of columnListEntries(columns).filter(ts.isObjectLiteralExpression)) {
    const read = propertyAssignment(entry, 'jsonPath') ?? propertyAssignment(entry, 'jsonArray');
    const edit = read ? jsonEntryEdit(entry, read) : prefixLengthEdit(entry);
    if (edit) {
      ctx.edits.push(edit);
    } else if (read) {
      ctx.report(
        entry,
        "read the JSON path off the column's ref, `{ column: post.kind.theme, type: Number }`; this entry could not be read",
      );
    }
  }
}

/** The read's options as the path's keys, and the type and length as written, `undefined` where it takes more than these. */
function readOptions(options: ts.ObjectLiteralExpression): JsonRead | undefined {
  const path = propertyValue(options, 'path');
  const type = propertyValue(options, 'type');
  const length = propertyValue(options, 'length');
  const known = [path, type, length].filter(Boolean).length;
  if (!type || (path && !ts.isStringLiteralLike(path)) || options.properties.length !== known) {
    return undefined;
  }
  const keys = path && ts.isStringLiteralLike(path) ? path.text.split('.') : [];
  return { keys, type, length };
}

/** The entry rewritten, or `undefined` where its read names a path or an option this cannot carry over. */
function jsonEntryEdit(entry: ts.ObjectLiteralExpression, read: ts.PropertyAssignment): Edit | undefined {
  const column = propertyValue(entry, 'column');
  const options = read.initializer;
  const parsed = column && ts.isObjectLiteralExpression(options) ? readOptions(options) : undefined;
  const entryLength = propertyValue(entry, 'length');
  if (!column || !parsed || (parsed.length && entryLength)) {
    return undefined;
  }
  const { keys, type } = parsed;
  const length = parsed.length ?? entryLength;
  const elements = propertyKey(read.name) === 'jsonArray';
  const rest = entry.properties.filter(
    (property) =>
      property !== read && !(ts.isPropertyAssignment(property) && MOVED_KEYS.has(propertyKey(property.name))),
  );
  const parts: Part[] = [
    '{ column: ',
    original(column),
    keys.reduce(memberAccess, ''),
    ', type: ',
    ...(elements ? ['[', original(type), ']'] : [original(type)]),
    ...(length ? [', charLength: ', original(length)] : []),
    ...rest.flatMap((property): Part[] => [', ', original(property)]),
    ' }',
  ];
  return replaced(entry, parts);
}

/** A column entry's `length` as the `prefixLength` it now names, `undefined` where it states none. */
function prefixLengthEdit(entry: ts.ObjectLiteralExpression): Edit | undefined {
  const length = propertyAssignment(entry, 'length');
  return length && replaced(length.name, 'prefixLength');
}

/** The keys only a migration builder's JSON entry states, whose `length` is the `CHAR(n)` it is read as. */
const JSON_ENTRY_KEYS = ['json', 'path', 'type'];

/** A migration builder's index entries, each `length` as the option it names now: `charLength` on JSON, `prefixLength` on a column. */
export function rewriteBuilderIndexLengths(columns: ts.Expression | undefined, ctx: Context): void {
  for (const entry of arrayElements(columns).filter(ts.isObjectLiteralExpression)) {
    const length = propertyAssignment(entry, 'length');
    const json = JSON_ENTRY_KEYS.some((key) => namedProperty(entry, key));
    if (length) {
      ctx.edits.push(replaced(length.name, json ? 'charLength' : 'prefixLength'));
    }
  }
}
