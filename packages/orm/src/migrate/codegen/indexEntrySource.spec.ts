import { describe, expect, it } from 'vitest';
import { createTableNode } from '../../schema/schemaAST.js';
import type { IndexNode } from '../../schema/types.js';
import type { IndexEntry } from '../../type/index.js';
import { buildIndexEntrySource, isPlainFieldIndex } from './indexEntrySource.js';

const asIs = (column: string) => column;

function indexNode(entries: IndexEntry<string>[], rest: Partial<IndexNode> = {}): IndexNode {
  return { name: 'idx', table: createTableNode('t'), entries, unique: false, ...rest };
}

/**
 * The cooked value of the first `sql` template in generated source, by running it as TypeScript
 * would. Comparing emitted text against an expected escaping would only restate the implementation;
 * this proves the source reads back as the SQL the database reported.
 */
function evaluateFirstTag(source: string): string {
  const start = source.indexOf('sql`');
  let end = start + 4;
  while (source[end] !== '`') {
    end += source[end] === '\\' ? 2 : 1;
  }
  return new Function(`return ${source.slice(start + 3, end + 1)};`)();
}

describe('buildIndexEntrySource', () => {
  /**
   * A database reprints an expression as arbitrary text: multi-line, either quote, backslashes. Every
   * one of those turns a hand-rolled string literal into source that does not compile, or - worse -
   * into source that compiles to a different index.
   */
  it('should write a JSON path value type named by its engine, not by a constructor', () => {
    const source = buildIndexEntrySource(indexNode([{ json: 'kind', path: 'price', type: 'decimal' }]), asIs, 'idx');
    expect(source).toContain("{ column: idx.kind.price, type: 'decimal' }");
  });

  it('should emit SQL that survives being read back as TypeScript', () => {
    const sql = '(\nCASE\n  WHEN name ~ \'\\d+\' THEN "col"\n END)';

    const source = buildIndexEntrySource(indexNode([{ expression: sql }]), asIs, 't');

    expect(evaluateFirstTag(source)).toBe(sql);
  });

  it('should emit SQL that would otherwise end or interpolate the template', () => {
    const sql = 'name = `a` || ${b}';

    const source = buildIndexEntrySource(indexNode([{ expression: sql }]), asIs, 't');

    expect(evaluateFirstTag(source)).toBe(sql);
  });

  it('should emit a predicate the same way', () => {
    const where = "name ~ '\\d+'";

    const source = buildIndexEntrySource(indexNode([{ column: 'name' }], { where }), asIs, 't');

    expect(evaluateFirstTag(source)).toBe(where);
  });

  it('should write an expression as raw in the list, its modifiers wrapped the way a column has them', () => {
    const index = indexNode([{ expression: 'lower(email)', order: 'desc' }, { column: 'email' }]);

    expect(buildIndexEntrySource(index, asIs, 't')).toBe(
      "index([{ column: sql`lower(email)`, order: 'desc' }, t.email], 'idx')",
    );
  });

  it('should read a column off the refs by name, bracketed only where no identifier can name it', () => {
    const index = indexNode([{ column: 'dueño' }, { column: 'first-name' }, { column: "o'clock" }], {
      include: ['größe'],
    });

    expect(buildIndexEntrySource(index, asIs, 't')).toBe(
      "index([t.dueño, t['first-name'], t['o\\'clock']], { name: 'idx', include: [t.größe] })",
    );
  });

  /** Left off, the entity it writes searches with `simple` and ranks every column alike. */
  /** Every engine reports a path inside a document as one, which the refs read the way a query names it. */
  it('should read a JSON path off its column ref, and the whole document where it names none', () => {
    const index = indexNode([
      { json: 'profile', path: 'theme.color' },
      { json: 'tags', order: 'desc' },
    ]);

    expect(buildIndexEntrySource(index, asIs, 't')).toBe(
      "index([t.profile.theme.color, { column: t.tags, order: 'desc' }], 'idx')",
    );
  });

  /** Left off, a number would be indexed as text, which no query comparing it as a number reads. */
  it('should keep the type a JSON path is read as, and its key length', () => {
    const index = indexNode([
      { json: 'kind', path: 'score', type: Number },
      { json: 'kind', path: 'name', charLength: 32 },
      { json: 'kind', path: 'tags', type: [String], charLength: 20 },
    ]);

    expect(buildIndexEntrySource(index, asIs, 't')).toBe(
      "index([{ column: t.kind.score, type: Number }, { column: t.kind.name, charLength: 32 }, { column: t.kind.tags, type: [String], charLength: 20 }], 'idx')",
    );
  });

  it("should keep a fulltext index's config and its entries' weights", () => {
    const index = indexNode([{ column: 'title', weight: 3 }, { column: 'body' }], {
      type: 'fulltext',
      config: 'english',
    });

    expect(buildIndexEntrySource(index, asIs, 't')).toBe(
      "index([{ column: t.title, weight: 3 }, t.body], { name: 'idx', type: 'fulltext', config: 'english' })",
    );
  });

  it('should leave off the config and the weight an index has without stating one', () => {
    const index = indexNode([{ column: 'title', weight: 1 }], { type: 'fulltext', config: 'simple' });

    expect(buildIndexEntrySource(index, asIs, 't')).toBe("index([t.title], { name: 'idx', type: 'fulltext' })");
  });

  it('should write a name holding a quote as source that still parses', () => {
    const index = indexNode([{ column: 'a' }, { column: 'b' }], { name: "it's" });

    expect(buildIndexEntrySource(index, asIs, 't')).toBe("index([t.a, t.b], 'it\\'s')");
  });

  it('should give a vector index the distance it was read back with', () => {
    const index = indexNode([{ column: 'embedding' }], { type: 'hnsw', distance: 'cosine' });

    expect(buildIndexEntrySource(index, asIs, 't')).toContain("type: 'hnsw', distance: 'cosine'");
  });

  it("should keep a vector index's build parameters", () => {
    const hnsw = indexNode([{ column: 'embedding' }], { type: 'hnsw', distance: 'l2', m: 16, efConstruction: 64 });
    const ivfflat = indexNode([{ column: 'embedding' }], { type: 'ivfflat', distance: 'l2', lists: 100 });

    expect(buildIndexEntrySource(hnsw, asIs, 't')).toBe(
      "index([t.embedding], { name: 'idx', type: 'hnsw', distance: 'l2', m: 16, efConstruction: 64 })",
    );
    expect(buildIndexEntrySource(ivfflat, asIs, 't')).toBe(
      "index([t.embedding], { name: 'idx', type: 'ivfflat', distance: 'l2', lists: 100 })",
    );
  });

  it("should keep a unique index's uniqueness and each entry's operator class and prefix length", () => {
    const index = indexNode(
      [
        { column: 'code', opsClass: 'text_pattern_ops' },
        { column: 'slug', prefixLength: 10 },
      ],
      {
        unique: true,
      },
    );

    expect(buildIndexEntrySource(index, asIs, 't')).toBe(
      "index([{ column: t.code, opsClass: 'text_pattern_ops' }, { column: t.slug, prefixLength: 10 }], { name: 'idx', unique: true })",
    );
  });

  // An index entry requires a distance beside a vector type, so a type with no recoverable metric would
  // generate an entity that does not compile.
  it('should leave off a vector type whose metric it cannot recover', () => {
    const source = buildIndexEntrySource(indexNode([{ column: 'embedding' }], { type: 'hnsw' }), asIs, 't');

    expect(source).not.toContain('hnsw');
  });
});

describe('isPlainFieldIndex', () => {
  // Postgres names an access method on every index it reports, so requiring none never matched there
  // and every plain index was written out as its own decorator.
  it('should treat the default access method as plain', () => {
    expect(isPlainFieldIndex(indexNode([{ column: 'email' }], { type: 'btree' }))).toBe(true);
  });

  /** A unique column is a unique index, which `@Field({ unique, index })` declares whole. */
  it('should carry a unique index on the field, as the uniqueness it is', () => {
    expect(isPlainFieldIndex(indexNode([{ column: 'email' }], { unique: true }))).toBe(true);
  });

  it.each([
    ['a predicate', { where: 'x IS NULL' }],
    ['stored columns', { include: ['a'] }],
    ['another access method', { type: 'gin' as const }],
  ])('should not carry an index with %s on the field', (_what, rest) => {
    expect(isPlainFieldIndex(indexNode([{ column: 'email' }], rest))).toBe(false);
  });

  it('should not carry an expression or a stored order on the field', () => {
    expect(isPlainFieldIndex(indexNode([{ expression: 'lower(email)' }]))).toBe(false);
    expect(isPlainFieldIndex(indexNode([{ column: 'email', order: 'desc' }]))).toBe(false);
  });
});
