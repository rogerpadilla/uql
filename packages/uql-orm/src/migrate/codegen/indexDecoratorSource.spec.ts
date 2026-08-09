import { describe, expect, it } from 'vitest';
import type { IndexNode, TableNode } from '../../schema/types.js';
import type { IndexColumnSchema } from '../../type/index.js';
import { buildIndexDecoratorSource, isPlainFieldIndex } from './indexDecoratorSource.js';

const asIs = (column: string) => column;

function indexNode(entries: IndexColumnSchema[], rest: Partial<IndexNode> = {}): IndexNode {
  return { name: 'idx', table: { name: 't' } as TableNode, entries, unique: false, ...rest };
}

describe('buildIndexDecoratorSource', () => {
  /**
   * A database reprints an expression as arbitrary text: multi-line, either quote, backslashes. Every
   * one of those turns a hand-rolled string literal into source that does not compile, or - worse -
   * into source that compiles to a different index.
   */
  it('should emit SQL that survives being read back as TypeScript', () => {
    const sql = '(\nCASE\n  WHEN name ~ \'\\d+\' THEN "col"\n END)';

    const source = buildIndexDecoratorSource(indexNode([{ column: sql, expression: true }]), asIs);

    const literal = source.slice(source.indexOf('raw(') + 4, source.lastIndexOf(')]'));
    expect(JSON.parse(literal)).toBe(sql);
  });

  it('should emit a predicate the same way', () => {
    const where = "name ~ '\\d+'";

    const source = buildIndexDecoratorSource(indexNode([{ column: 'name' }], { where }), asIs);

    expect(source).toContain(`where: ${JSON.stringify(where)}`);
  });

  it('should give a vector index the distance its operator class carries', () => {
    const index = indexNode([{ column: 'embedding', opsClass: 'vector_cosine_ops' }], { type: 'hnsw' });

    expect(buildIndexDecoratorSource(index, asIs)).toContain("type: 'hnsw', distance: 'cosine'");
  });

  // `@Index` requires a distance beside a vector type, so a type with no recoverable metric would
  // generate an entity that does not compile.
  it('should leave off a vector type whose metric it cannot recover', () => {
    const source = buildIndexDecoratorSource(indexNode([{ column: 'embedding' }], { type: 'hnsw' }), asIs);

    expect(source).not.toContain('hnsw');
  });
});

describe('isPlainFieldIndex', () => {
  // Postgres names an access method on every index it reports, so requiring none never matched there
  // and every plain index was written out as its own decorator.
  it('should treat the default access method as plain', () => {
    expect(isPlainFieldIndex(indexNode([{ column: 'email' }], { type: 'btree' }))).toBe(true);
  });

  it.each([
    ['unique', { unique: true }],
    ['a predicate', { where: 'x IS NULL' }],
    ['stored columns', { include: ['a'] }],
    ['another access method', { type: 'gin' as const }],
  ])('should not carry an index with %s on the field', (_what, rest) => {
    expect(isPlainFieldIndex(indexNode([{ column: 'email' }], rest))).toBe(false);
  });

  it('should not carry an expression or a stored order on the field', () => {
    expect(isPlainFieldIndex(indexNode([{ column: 'lower(email)', expression: true }]))).toBe(false);
    expect(isPlainFieldIndex(indexNode([{ column: 'email', order: 'desc' }]))).toBe(false);
  });
});
