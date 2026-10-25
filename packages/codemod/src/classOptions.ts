import ts from 'typescript';
import type { Context } from './context.js';
import { type Edit, original, type Part } from './edits.js';
import { memberKey } from './keyMaps.js';
import {
  arrayElements,
  decoratorName,
  decoratorsOf,
  indentOf,
  indentUnit,
  lineStartOf,
  namedProperty,
  objectLiteral,
} from './syntax.js';

/** The class decorators `@Entity`'s options took over, each with the option its entries go under. */
const FOLDED = { Index: 'indexes', Trigger: 'triggers', Filter: 'filters' } as const;

type Folded = keyof typeof FOLDED;
type Option = (typeof FOLDED)[Folded];

const isFolded = (name: string | undefined): name is Folded => name !== undefined && Object.hasOwn(FOLDED, name);

/**
 * One entry for an option: the parts writing it, each a stretch of the original where it is kept as written, and
 * the comments above its decorator, which a `@ts-expect-error` or an explanation needs kept on the line above it.
 */
type Entry = { readonly parts: readonly Part[]; readonly comments: readonly string[] };

type Slot = { readonly before: readonly Entry[]; readonly after: readonly Entry[] };

const slotEntries = (entries: ReadonlyMap<Option, Slot>) =>
  new Map([...entries].map(([option, { before, after }]) => [option, [...before, ...after]] as const));

/**
 * Folds `@Index`, `@Trigger` and `@Filter` into the class's `@Entity` options, `indexes`, `triggers` and `filters`.
 * Triggers keep the order they register in, which is the order they run in: decorators apply bottom-up, so those
 * below `@Entity` go ahead of its own and those above after them. Indexes and filters, whose order means nothing,
 * follow `@Entity`'s own in the order written. A class with no `@Entity` becomes `@Entity({ abstract: true, ... })`.
 */
export function foldClassDecorators(node: ts.ClassLikeDeclaration, ctx: Context): void {
  const decorators = decoratorsOf(node);
  const unit = indentUnit(node.getSourceFile());
  const entity = decorators.find((decorator) => decoratorName(decorator) === 'Entity');
  const at = entity ? decorators.indexOf(entity) : -1;
  const folded = decorators.flatMap((decorator, index) => {
    const name = decoratorName(decorator);
    return isFolded(name) && ts.isCallExpression(decorator.expression)
      ? [{ decorator, call: decorator.expression, name, index }]
      : [];
  });
  if (!folded.length) {
    return;
  }
  const call = entity && entityCall(entity, ctx);
  const options = call && entityOptions(call, ctx);
  if (call === null || options === null) {
    return;
  }
  const triggers = folded.filter(({ name }) => name === 'Trigger');
  const applied = (above: boolean) => triggers.filter(({ index }) => index < at === above).toReversed();
  const before = applied(false);
  const after = [...applied(true), ...folded.filter(({ name }) => name !== 'Trigger')];
  const entries = new Map<Option, { before: Entry[]; after: Entry[] }>();
  for (const [list, side] of [
    [before, 'before'],
    [after, 'after'],
  ] as const) {
    for (const { call, name, decorator } of list) {
      const written = entriesOf(name, call, decorator, ctx);
      if (!written) {
        return;
      }
      const comments = commentTexts(decorator);
      const slot = entries.get(FOLDED[name]) ?? { before: [], after: [] };
      slot[side].push(...written.map((parts, index) => ({ parts, comments: index ? [] : comments })));
      entries.set(FOLDED[name], slot);
    }
  }
  for (const { decorator, name } of folded) {
    ctx.edits.push(removedDecorator(decorator));
    ctx.rewritten[name] += 1;
  }
  if (!call) {
    const first = removedDecorator(folded[0].decorator);
    const indent = indentOf(folded[0].decorator);
    const text: Part[] = ['@Entity({ abstract: true, ', ...optionParts(slotEntries(entries), indent, unit), ' })'];
    const onItsLine = node.getSourceFile().text.slice(first.start, first.end).endsWith('\n');
    ctx.edits.push({
      start: first.start,
      end: first.start,
      text: onItsLine ? [indent, ...text, '\n'] : [...text, ' '],
    });
    ctx.imports.set('Entity', 'the abstract base its class decorators moved into');
    return;
  }
  ctx.edits.push(...entityEdits(call, options, entries, unit));
}

/** `@Entity`'s call, or `null`, reported, where it is written uncalled and so takes no options. */
function entityCall(entity: ts.Decorator, ctx: Context): ts.CallExpression | null {
  if (ts.isCallExpression(entity.expression)) {
    return entity.expression;
  }
  ctx.report(entity, "call '@Entity()' to move '@Index', '@Trigger' and '@Filter' into its options");
  return null;
}

/** `@Entity`'s options literal, `undefined` where it takes none, or `null`, reported, where it cannot be read. */
function entityOptions(call: ts.CallExpression, ctx: Context): ts.ObjectLiteralExpression | undefined | null {
  const [first] = call.arguments;
  if (!first) {
    return undefined;
  }
  const literal = objectLiteral(first);
  if (!literal) {
    ctx.report(call, "move '@Index', '@Trigger' and '@Filter' into '@Entity' options this cannot read");
    return null;
  }
  return literal;
}

/** The entries one decorator registers, or nothing, reported, where it cannot say them as an option. */
function entriesOf(
  name: Folded,
  call: ts.CallExpression,
  decorator: ts.Decorator,
  ctx: Context,
): (readonly Part[])[] | undefined {
  const [first, second] = call.arguments;
  if (name === 'Trigger') {
    return call.arguments.map((trigger) => [original(trigger)]);
  }
  if (name === 'Index') {
    if (!first) {
      ctx.report(decorator, "move this '@Index' into '@Entity({ indexes })' by hand: it names no columns");
      return undefined;
    }
    const props = objectLiteral(second);
    const rest: Part[] = props
      ? props.properties.flatMap((prop) => [', ', original(prop)])
      : second
        ? [', ...', original(second)]
        : [];
    return [['{ columns: ', original(first), ...rest, ' }']];
  }
  if (!first || !ts.isStringLiteralLike(first) || !second) {
    ctx.report(decorator, "move this '@Filter' into '@Entity({ filters })' by hand: its name is not a string");
    return undefined;
  }
  return [[memberKey(first.text), ': ', original(second)]];
}

/** Each option's entries as comma-separated properties, a list holding a comment one entry a line. */
function optionParts(entries: ReadonlyMap<Option, readonly Entry[]>, indent: string, unit: string): Part[] {
  return [...entries].flatMap(([option, list], index) => [
    ...(index ? [', '] : []),
    ...bracketed(option, list, indent, unit),
  ]);
}

function bracketed(option: Option, list: readonly Entry[], indent: string, unit: string): Part[] {
  const [open, close] = option === 'filters' ? ['{', '}'] : ['[', ']'];
  if (list.length < 2 && !list.some(({ comments }) => comments.length)) {
    const pad = option === 'filters' ? ' ' : '';
    return [`${option}: ${open}${pad}`, ...joined(list, ', '), `${pad}${close}`];
  }
  const inner = `${indent}${unit}`;
  return [`${option}: ${open}\n`, ...lines(list, inner), `${indent}${close}`];
}

function joined(list: readonly Entry[], separator: string): Part[] {
  return list.flatMap(({ parts }, index) => (index ? [separator, ...parts] : [...parts]));
}

/** Each entry on its own line under `indent`, its comments on the lines above it. */
function lines(list: readonly Entry[], indent: string): Part[] {
  return list.flatMap(({ parts, comments }) => [
    ...comments.flatMap((comment) => [indent, comment, '\n']),
    indent,
    ...parts,
    ',\n',
  ]);
}

/**
 * The line comments directly above `decorator`, which say something of it: a run with no blank line before the
 * decorator. A doc comment, or one a blank line parts from it, is the class's and stays where it is.
 */
function decoratorComments(decorator: ts.Decorator): readonly ts.CommentRange[] {
  const text = decorator.getSourceFile().text;
  const ranges = ts.getLeadingCommentRanges(text, decorator.pos) ?? [];
  const kept: ts.CommentRange[] = [];
  let next = decorator.getStart();
  for (const range of ranges.toReversed()) {
    const between = text.slice(range.end, next);
    if (range.kind !== ts.SyntaxKind.SingleLineCommentTrivia || /\n\s*\n/.test(between)) break;
    kept.unshift(range);
    next = range.pos;
  }
  return kept;
}

/** A comment closing the decorator's line, which says something of it too. */
function trailingComments(decorator: ts.Decorator): readonly ts.CommentRange[] {
  const text = decorator.getSourceFile().text;
  return (ts.getTrailingCommentRanges(text, decorator.getEnd()) ?? []).filter(
    ({ kind }) => kind === ts.SyntaxKind.SingleLineCommentTrivia,
  );
}

/** The comments the decorator's entry carries: those above it, then the one closing its line. */
function commentTexts(decorator: ts.Decorator): string[] {
  const text = decorator.getSourceFile().text;
  return [...decoratorComments(decorator), ...trailingComments(decorator)].map(({ pos, end }) => text.slice(pos, end));
}

/** The edits writing `entries` into `@Entity`'s options, each option's own list merged where it states one. */
function entityEdits(
  call: ts.CallExpression,
  options: ts.ObjectLiteralExpression | undefined,
  entries: ReadonlyMap<Option, Slot>,
  unit: string,
): Edit[] {
  const indent = indentOf(call);
  if (!options) {
    const at = call.getEnd() - 1;
    return [{ start: at, end: at, text: ['{ ', ...optionParts(slotEntries(entries), indent, unit), ' }'] }];
  }
  const edits: Edit[] = [];
  const added = new Map<Option, Entry[]>();
  for (const [option, slot] of entries) {
    const stated = namedProperty(options, option);
    const value = stated && ts.isPropertyAssignment(stated) ? stated.initializer : undefined;
    const list =
      value && (ts.isArrayLiteralExpression(value) ? arrayElements(value) : objectLiteral(value)?.properties);
    if (!value || !list) {
      added.set(option, [...slot.before, ...slot.after]);
      continue;
    }
    const open = value.getStart() + 1;
    const close = value.getEnd() - 1;
    const inner = `${indentOf(value)}${unit}`;
    const commented = (side: readonly Entry[]) => side.some(({ comments }) => comments.length);
    if (slot.before.length) {
      const text = commented(slot.before)
        ? ['\n', ...lines(slot.before, inner), inner]
        : [...joined(slot.before, ', '), ...(list.length ? [', '] : [])];
      edits.push({ start: open, end: open, text });
    }
    if (slot.after.length) {
      const end = list.length ? list[list.length - 1].getEnd() : close;
      const lead = list.length || slot.before.length ? ', ' : '';
      const text = commented(slot.after)
        ? slot.after.flatMap(({ parts, comments }, index) => [
            index || lead ? ',\n' : '\n',
            ...comments.flatMap((comment) => [inner, comment, '\n']),
            inner,
            ...parts,
          ])
        : [lead, ...joined(slot.after, ', ')];
      edits.push({ start: end, end, text });
    }
  }
  if (added.size) {
    const last = options.properties.at(-1);
    const at = last ? last.getEnd() : options.getEnd() - 1;
    const parts = optionParts(added, indent, unit);
    edits.push({ start: at, end: at, text: last ? [', ', ...parts] : [' ', ...parts, ' '] });
  }
  return edits;
}

/** Removes a decorator, with its line where it stands alone on one, or the blank after it where it shares one. */
function removedDecorator(decorator: ts.Decorator): Edit {
  const text = decorator.getSourceFile().text;
  const start = decoratorComments(decorator)[0]?.pos ?? decorator.getStart();
  const end = trailingComments(decorator).at(-1)?.end ?? decorator.getEnd();
  const lineStart = lineStartOf(text, start);
  const lineEnd = text.indexOf('\n', end);
  // A class follows its decorators, so the line of one standing alone ends before the file does.
  const alone = text.slice(lineStart, start).trim() === '' && text.slice(end, lineEnd).trim() === '';
  if (alone) {
    return { start: lineStart, end: lineEnd + 1, text: '' };
  }
  const after = /\s*/y;
  after.lastIndex = end;
  after.exec(text);
  return { start, end: after.lastIndex, text: '' };
}
