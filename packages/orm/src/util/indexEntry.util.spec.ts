import { describe, expect, it } from 'vitest';
import type { IndexEntry, Json } from '../type/index.js';
import { indexEntryNamePart, isStored, normalizeIndexColumn, renderIndexColumn } from './indexEntry.util.js';
import { indexRefs, refs, sql } from './sql.js';

class Note {
  email?: string;
  settings?: Json<{ theme: { color: string }; rating: number; tags: string[]; then: string }>;
}

describe('normalizeIndexColumn', () => {
  it('should keep a column, named or read off the refs, as its key', () => {
    expect(normalizeIndexColumn('email')).toEqual({ column: 'email' });
    expect(normalizeIndexColumn(refs(Note).email)).toEqual({ column: 'email' });
  });

  it('should keep any other raw as the expression it is', () => {
    const statement = sql`lower(email)`;
    expect(normalizeIndexColumn(statement)).toEqual({ expression: statement });
  });

  it("should resolve an options entry's column the same way, keeping its options", () => {
    const statement = sql`lower(email)`;
    expect(normalizeIndexColumn({ column: refs(Note).email, order: 'desc' })).toEqual({
      column: 'email',
      order: 'desc',
    });
    expect(normalizeIndexColumn({ column: refs(Note).email, prefixLength: 64 })).toEqual({
      column: 'email',
      prefixLength: 64,
    });
    expect(normalizeIndexColumn({ column: statement, order: 'desc' })).toEqual({
      expression: statement,
      order: 'desc',
    });
  });

  it('should read a JSON path off the refs as its column and dotted path, and keep how it is read', () => {
    const note = indexRefs<Note>();
    expect(normalizeIndexColumn(note.settings.theme.color)).toEqual({ json: 'settings', path: 'theme.color' });
    expect(normalizeIndexColumn({ column: note.settings.rating, type: Number })).toEqual({
      json: 'settings',
      path: 'rating',
      type: Number,
    });
    expect(normalizeIndexColumn({ column: note.settings.tags, type: [String], charLength: 64 })).toEqual({
      json: 'settings',
      path: 'tags',
      type: [String],
      charLength: 64,
    });
  });

  it('should read a payload key named `then` as a path, a ref being no thenable to await', async () => {
    const settings = indexRefs<Note>().settings;
    expect(await Promise.resolve(settings)).toBe(settings);
    expect(normalizeIndexColumn(settings.then)).toEqual({ json: 'settings', path: 'then' });
  });

  it("should keep the migration builder's entry as it is, already in this form", () => {
    expect(normalizeIndexColumn({ json: 'settings', path: 'rating', type: Number })).toEqual({
      json: 'settings',
      path: 'rating',
      type: Number,
    });
  });

  it('should refuse an entry naming no column or expression, such as a member a ref owns', () => {
    const note = indexRefs<Note>();
    // @ts-expect-error a ref's own method, which no path reads through
    expect(() => normalizeIndexColumn(note.settings.as)).toThrow('an index entry names no column or expression');
    // @ts-expect-error no column
    expect(() => normalizeIndexColumn({ order: 'desc' })).toThrow('an index entry names no column or expression');
  });

  it('should refuse an option no entry takes, which a returned literal is not checked for', () => {
    const note = indexRefs<Note>();
    expect(() =>
      normalizeIndexColumn(
        // @ts-expect-error the old spelling of a JSON path, now read off the refs
        { column: note.settings, jsonPath: { path: 'rating', type: Number } },
      ),
    ).toThrow("an index entry has no option 'jsonPath'");
    // @ts-expect-error a typo
    expect(() => normalizeIndexColumn({ column: note.email, ordr: 'desc' })).toThrow(
      "an index entry has no option 'ordr'",
    );
  });

  /** A column's ref and other `sql` share a type, so only the run time tells which takes a prefix. */
  it('should refuse a length its target does not take', () => {
    const note = indexRefs<Note>();
    expect(() => normalizeIndexColumn({ column: sql`lower(email)`, prefixLength: 64 })).toThrow(
      'an index entry over an expression takes no prefixLength',
    );
    // @ts-expect-error a JSON path is sized by its charLength
    expect(() => normalizeIndexColumn({ column: note.settings.theme.color, prefixLength: 64 })).toThrow(
      'an index entry over a JSON path takes no prefixLength',
    );
    // @ts-expect-error a stored column is keyed by a prefix
    expect(() => normalizeIndexColumn({ column: note.email, charLength: 64 })).toThrow(
      'an index entry over a stored column takes no charLength',
    );
  });

  it('should refuse the same length on a column the migration builder names by its string', () => {
    // @ts-expect-error a stored column takes no charLength, and the type says so; plain JavaScript reaches here
    expect(() => normalizeIndexColumn({ column: 'email', charLength: 64 })).toThrow(
      'an index entry over a stored column takes no charLength',
    );
  });
});

describe('renderIndexColumn', () => {
  it('should render an expression entry to text, keeping its options', () => {
    expect(renderIndexColumn({ expression: sql`lower(email)`, order: 'desc' }, () => 'lower(email)')).toEqual({
      expression: 'lower(email)',
      order: 'desc',
    });
  });

  it('should keep a column entry as it is', () => {
    expect(renderIndexColumn({ column: 'email' }, () => 'unused')).toEqual({ column: 'email' });
  });
});

describe('isStored', () => {
  it('should tell entries all over stored columns from ones reading a JSON path or an expression', () => {
    const stored: IndexEntry<string>[] = [{ column: 'a' }, { column: 'b', prefixLength: 4 }];
    expect(isStored(stored)).toBe(true);
    expect(isStored([...stored, { json: 'kind', path: 'theme' }])).toBe(false);
    expect(isStored([...stored, { expression: 'lower(a)' }])).toBe(false);
  });
});

describe('indexEntryNamePart', () => {
  it('should name an expression by its position, having no column to name it by', () => {
    expect([{ column: 'tenantId' }, { expression: sql`lower(email)` }].map(indexEntryNamePart)).toEqual([
      'tenantId',
      'expr1',
    ]);
  });

  it('should name a JSON path by its column and the path, so two paths of one column stay apart', () => {
    expect(
      [
        { json: 'kind', path: 'theme.color' },
        { json: 'kind', path: 'rating', type: Number },
      ].map(indexEntryNamePart),
    ).toEqual(['kind_theme_color', 'kind_rating']);
  });
});
