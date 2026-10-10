import type ts from 'typescript';

/** A stretch of the original text, which a replacement can keep. */
export type Span = { readonly start: number; readonly end: number };

/** A piece of a replacement: text written, or a stretch of the original kept. */
export type Part = string | Span;

/** What replaces a range: text, or text with stretches of the original in it, edits inside them included. */
export type Replacement = string | readonly Part[];

/** One text replacement in a file. */
export type Edit = { readonly start: number; readonly end: number; readonly text: Replacement };

/** The text of `node` as written, for a replacement to keep. */
export function original(node: ts.Node): Span {
  return { start: node.getStart(), end: node.getEnd() };
}

const isInsertion = (edit: Edit): boolean => edit.start === edit.end;

/**
 * Applies edits to `source`, which is spliced rather than reprinted: a codemod that reformats everything it
 * touches buries its own change in the diff. An edit inside a range another replaces is moot, unless that
 * replacement keeps the stretch it sits in; edits that overlap without one holding the other are a bug.
 */
export function applyEdits(source: string, edits: readonly Edit[]): string {
  const ordered = edits
    .map((edit, index) => ({ edit, index }))
    .sort(
      (a, b) =>
        a.edit.start - b.edit.start ||
        Number(!isInsertion(a.edit)) - Number(!isInsertion(b.edit)) ||
        (isInsertion(a.edit) ? b.index - a.index : b.edit.end - a.edit.end),
    )
    .map(({ edit }) => edit);
  return render(source, ordered, { start: 0, end: source.length });
}

/**
 * `range` of `source` with `edits` (ordered outermost first, an insertion before a replacement at its offset, a
 * later insertion before an earlier) applied. `parent` is the edit keeping `range`: an insertion at its edges
 * is written beside it, so it is not written again inside.
 */
function render(source: string, edits: readonly Edit[], range: Span, parent?: Edit): string {
  const within = (edit: Edit): boolean =>
    edit !== parent &&
    range.start <= edit.start &&
    edit.end <= range.end &&
    !(parent && isInsertion(edit) && (edit.start === parent.start || edit.start === parent.end));
  const inside = edits.filter(within);
  let written = '';
  let at = range.start;
  for (const edit of inside) {
    if (edit.start < at) {
      if (edit.end > at) {
        throw new Error(`overlapping edits at ${edit.start}`);
      }
      continue;
    }
    const parts = typeof edit.text === 'string' ? [edit.text] : edit.text;
    written += source.slice(at, edit.start);
    written += parts.map((part) => (typeof part === 'string' ? part : render(source, inside, part, edit))).join('');
    at = edit.end;
  }
  return written + source.slice(at, range.end);
}

export function replaced(node: ts.Node, text: Replacement): Edit {
  return { ...original(node), text };
}

export function inserted(node: ts.Node, text: string): Edit {
  return { start: node.getStart(), end: node.getStart(), text };
}

export function appended(node: ts.Node, text: string): Edit {
  return { start: node.getEnd(), end: node.getEnd(), text };
}

/**
 * Removes elements of a comma-separated list with the separators that would dangle. Each removed element takes
 * the text up to the next item; the removed run at the end takes the separator before it, so the ranges never
 * overlap. `source` is passed because a tree from `ts.parseJsonText` carries no back-reference for `getStart()`.
 */
export function removeFromList(
  items: readonly ts.Node[],
  removed: readonly ts.Node[],
  source: ts.SourceFile,
): readonly Edit[] {
  const kept = items.map((item) => !removed.includes(item));
  const lastKept = kept.lastIndexOf(true);
  const between = items
    .slice(0, lastKept + 1)
    .flatMap((item, at) =>
      kept[at] ? [] : [{ start: item.getStart(source), end: items[at + 1].getStart(source), text: '' }],
    );
  const trailing = items.slice(lastKept + 1);
  if (!trailing.length) {
    return between;
  }
  const from = lastKept < 0 ? trailing[0].getStart(source) : items[lastKept].getEnd();
  return [...between, { start: from, end: items[items.length - 1].getEnd(), text: '' }];
}

/** Removes a statement together with the rest of its line, so nothing is left blank behind it. */
export function removeStatement(node: ts.Node): Edit {
  const source = node.getSourceFile();
  const line = source.getLineAndCharacterOfPosition(node.getEnd()).line;
  const nextLineStart = source.getLineStarts()[line + 1];
  return { start: node.getStart(), end: nextLineStart ?? node.getEnd(), text: '' };
}
