import type ts from 'typescript';

/** One text replacement in a file. */
export type Edit = { readonly start: number; readonly end: number; readonly text: string };

/**
 * Applies edits back to front, so none shifts the offsets of another, and at a shared offset the replacement
 * first, so an insertion there lands before it. Splicing rather than reprinting keeps the rest of the file
 * byte for byte: a codemod that reformats everything it touches buries its own change in the diff.
 */
export function applyEdits(text: string, edits: readonly Edit[]): string {
  let result = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

export function replaced(node: ts.Node, text: string): Edit {
  return { start: node.getStart(), end: node.getEnd(), text };
}

export function inserted(node: ts.Node, text: string): Edit {
  return { start: node.getStart(), end: node.getStart(), text };
}

export function appended(node: ts.Node, text: string): Edit {
  return { start: node.getEnd(), end: node.getEnd(), text };
}

/**
 * Removes one element of a comma-separated list with the separator that would dangle: the comma before the
 * last element, the one after any other. `source` is passed because a tree from `ts.parseJsonText` carries
 * no back-reference for `getStart()` to find.
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

/** Removes a statement together with the rest of its line, so nothing is left blank behind it. */
export function removeStatement(node: ts.Node): Edit {
  const source = node.getSourceFile();
  const line = source.getLineAndCharacterOfPosition(node.getEnd()).line;
  const nextLineStart = source.getLineStarts()[line + 1];
  return { start: node.getStart(), end: nextLineStart ?? node.getEnd(), text: '' };
}
