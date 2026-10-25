import ts from 'typescript';
import { lineStartOf } from './syntax.js';

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
  return editedText(source, edits).text;
}

/** One edit's range, where it was in the source and where its text went. */
type Moved = { readonly start: number; readonly end: number; readonly from: number; readonly to: number };

/** A text a pass wrote, with where each of its offsets was in the text the pass read. */
export type Pass = { readonly text: string; readonly sourceOffset: (at: number) => number };

/** `text` as a pass that changed nothing. */
export const unedited = (text: string): Pass => ({ text, sourceOffset: (at) => at });

/** `second` run on what `first` wrote, each offset of its text mapped back to what `first` read. */
export function followed(first: Pass, second: Pass): Pass {
  return { text: second.text, sourceOffset: (at) => first.sourceOffset(second.sourceOffset(at)) };
}

/** `pass` edited again by `edits`, which read its text. */
function editedAgain(pass: Pass, edits: readonly Edit[]): Pass {
  return followed(pass, editedText(pass.text, edits));
}

/** `pass` edited again by the edits `edits` reads off its text, parsed. */
export function reparsedAgain(fileName: string, pass: Pass, edits: (source: ts.SourceFile) => readonly Edit[]): Pass {
  return editedAgain(pass, edits(ts.createSourceFile(fileName, pass.text, ts.ScriptTarget.Latest, true)));
}

/**
 * {@link applyEdits}, with where each offset of the result was in `source`, for a later pass reading the result to
 * report against the file as written: an offset inside an edit's text maps to where the edit starts.
 */
export function editedText(source: string, edits: readonly Edit[]): Pass {
  const moved: Moved[] = [];
  const ordered = edits
    .map((edit, index) => ({ edit, index }))
    .sort(
      (a, b) =>
        a.edit.start - b.edit.start ||
        Number(!isInsertion(a.edit)) - Number(!isInsertion(b.edit)) ||
        (isInsertion(a.edit) ? b.index - a.index : b.edit.end - a.edit.end),
    )
    .map(({ edit }) => edit);
  const text = render(source, ordered, { start: 0, end: source.length }, undefined, moved);
  const sourceOffset = (at: number): number => {
    const before = moved.findLast((edit) => edit.from <= at);
    if (!before) return at;
    return at < before.to ? before.start : before.end + at - before.to;
  };
  return { text, sourceOffset };
}

/**
 * `range` of `source` with `edits` (ordered outermost first, an insertion before a replacement at its offset, a
 * later insertion before an earlier) applied. `parent` is the edit keeping `range`: an insertion at its edges
 * is written beside it, so it is not written again inside.
 */
function render(source: string, edits: readonly Edit[], range: Span, parent?: Edit, moved?: Moved[]): string {
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
    const from = written.length;
    written += parts.map((part) => (typeof part === 'string' ? part : render(source, inside, part, edit))).join('');
    moved?.push({ start: edit.start, end: edit.end, from, to: written.length });
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

/** `node`'s text with each of `uses`, the nodes inside it, written as `text`. */
export function replacingUses(node: ts.Node, uses: readonly ts.Node[], text: string): string {
  return applyEdits(
    node.getText(),
    uses.map((use) => ({ start: use.getStart() - node.getStart(), end: use.getEnd() - node.getStart(), text })),
  );
}

/**
 * Removes elements of a comma-separated list, at least one of them kept, with the separators that would dangle.
 * Each removed element takes the text up to the next item; the removed run at the end takes the separator before
 * it, so the ranges never overlap. `source` is passed because a tree from `ts.parseJsonText` has no `getStart()`.
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
  return [...between, { start: items[lastKept].getEnd(), end: items[items.length - 1].getEnd(), text: '' }];
}

/**
 * Removes a statement with the blanks before it on its line, the rest of its line and the blank lines after it,
 * so nothing is left blank behind it.
 */
export function removeStatement(node: ts.Node): Edit {
  const text = node.getSourceFile().text;
  const lineStart = lineStartOf(text, node.getStart());
  const head = text.slice(lineStart, node.getStart());
  const after = /[^\n]*\n?(?:[ \t]*\n)*/y;
  after.lastIndex = node.getEnd();
  after.exec(text);
  return { start: lineStart + head.replace(/[ \t]*$/, '').length, end: after.lastIndex, text: '' };
}
