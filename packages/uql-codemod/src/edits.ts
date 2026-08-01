import type ts from 'typescript';

/** One text replacement in a file. */
export type Edit = { readonly start: number; readonly end: number; readonly text: string };

/**
 * Applies edits back to front, so an earlier edit cannot shift the offsets of a later one.
 *
 * Replacing text rather than reprinting the file is what keeps the rest of it byte-for-byte: a codemod
 * that reformats everything it touches buries its own change in the diff.
 */
export function applyEdits(text: string, edits: readonly Edit[]): string {
  let result = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

/**
 * Removes one element of a comma-separated list - a parameter, a named import, a JSON property - taking
 * the separator that would otherwise dangle. The last element gives up the comma before it; any other
 * gives up the one after.
 *
 * The source file is passed explicitly because a tree from `ts.parseJsonText` carries no
 * back-reference, so `getStart()` cannot find one on its own.
 */
export function removeFromList(items: readonly ts.Node[], item: ts.Node, source: ts.SourceFile): Edit {
  const at = items.indexOf(item);
  const next = items[at + 1];
  const previous = items[at - 1];
  return {
    start: previous && !next ? previous.getEnd() : item.getStart(source),
    end: next ? next.getStart(source) : item.getEnd(),
    text: '',
  };
}
