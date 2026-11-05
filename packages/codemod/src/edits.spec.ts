import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { applyEdits, editedText, removeFromList } from './edits.js';

describe('applyEdits', () => {
  it('splices each edit where it was read, whatever order they were found in', () => {
    const edits = [
      { start: 4, end: 5, text: 'Y' },
      { start: 0, end: 1, text: 'X' },
    ];

    expect(applyEdits('a bcd', edits)).toBe('X bcY');
  });

  it('lands an insertion before a replacement at the same offset, a later insertion before an earlier', () => {
    const edits = [
      { start: 1, end: 1, text: '1' },
      { start: 1, end: 2, text: 'X' },
      { start: 1, end: 1, text: '2' },
    ];

    expect(applyEdits('abc', edits)).toBe('a21Xc');
  });

  it('writes the edits inside a stretch a replacement keeps', () => {
    const edits = [
      { start: 0, end: 7, text: ['<', { start: 2, end: 5 }, '>'] },
      { start: 2, end: 5, text: 'sql' },
    ];

    expect(applyEdits('a raw b', edits)).toBe('<sql>');
  });

  it('drops an edit inside a replaced stretch it does not keep', () => {
    const edits = [
      { start: 1, end: 5, text: 'X' },
      { start: 2, end: 3, text: 'Y' },
    ];

    expect(applyEdits('abcdef', edits)).toBe('aXf');
  });

  it('writes an insertion at the edge of a replacement outside it, once, though the replacement keeps that stretch', () => {
    const edits = [
      { start: 0, end: 3, text: ['x', { start: 0, end: 3 }] },
      { start: 0, end: 0, text: '!' },
      { start: 3, end: 3, text: '?' },
    ];

    expect(applyEdits('abc', edits)).toBe('!xabc?');
  });

  it('refuses edits that overlap without one holding the other', () => {
    const edits = [
      { start: 0, end: 3, text: 'X' },
      { start: 2, end: 5, text: 'Y' },
    ];

    expect(() => applyEdits('abcdef', edits)).toThrow('overlapping edits');
  });
});

describe('editedText', () => {
  /** `ab|cd|ef` with `cd` replaced by `XYZ`: before it the offset holds, inside it maps to its start, after it shifts. */
  it('maps each offset of the result back to where it was written', () => {
    const { text, sourceOffset } = editedText('abcdef', [{ start: 2, end: 4, text: 'XYZ' }]);

    expect(text).toBe('abXYZef');
    expect([0, 1, 2, 4, 5, 6].map(sourceOffset)).toEqual([0, 1, 2, 2, 4, 5]);
  });
});

describe('removeFromList', () => {
  const removing = (text: string, at: number) => {
    const source = ts.createSourceFile('/list.ts', text, ts.ScriptTarget.Latest, true);
    const [statement] = source.statements;
    const list = ts.isExpressionStatement(statement) ? statement.expression : undefined;
    if (!list || !ts.isArrayLiteralExpression(list)) throw new TypeError(`no array in ${text}`);
    return applyEdits(text, removeFromList(list.elements, [list.elements[at]], source));
  };

  it('takes the separator after an element, or before the last one', () => {
    expect(removing('[a, b, c]', 0)).toBe('[b, c]');
    expect(removing('[a, b, c]', 2)).toBe('[a, b]');
  });

  it("keeps the next element's comment with it", () => {
    expect(removing('[\n  a,\n  // why\n  b,\n]', 0)).toBe('[\n  // why\n  b,\n]');
  });
});
