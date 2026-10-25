import { describe, expect, it } from 'vitest';
import { mockTableNode } from '../test/index.js';
import { describeIndexDifferences, indexChanges, indexNameStem, indexSignature } from './indexDifferences.js';
import type { IndexNode } from './types.js';

describe('describeIndexDifferences', () => {
  const table = mockTableNode('users', [{ name: 'email' }]);
  const index = (overrides: Partial<IndexNode>): IndexNode => ({
    name: 'users__email_idx',
    table,
    entries: [{ column: 'email' }],
    unique: false,
    ...overrides,
  });

  /** An access method neither side states is btree, so an unstated one compares as that default. */
  it('should report a uniqueness change, and read an unstated access method as btree', () => {
    expect(
      describeIndexDifferences(index({}), index({ unique: true, type: 'hash' }), new Set(['accessMethod'])),
    ).toEqual([expect.stringMatching(/^unique: true .* false$/), expect.stringMatching(/^type: hash .* btree$/)]);
    expect(describeIndexDifferences(index({ type: 'hash' }), index({}), new Set(['accessMethod']))).toEqual([
      expect.stringMatching(/^type: btree .* hash$/),
    ]);
  });

  /**
   * MongoDB keeps a text index's weights and lists its fields alphabetically, so the order is no
   * difference there and a weight is; an engine that ranks by weights at query time stores none to compare.
   */
  it('should compare a text index as its fields and their weights, where the engine keeps them', () => {
    const text = (entries: IndexNode['entries']) => index({ type: 'fulltext', entries });
    const declared = text([{ column: 'zeta', weight: 10 }, { column: 'alpha' }]);
    const weights = new Set(['textIndex'] as const);
    expect(
      describeIndexDifferences(declared, text([{ column: 'alpha' }, { column: 'zeta', weight: 10 }]), weights),
    ).toEqual([]);
    expect(
      describeIndexDifferences(declared, text([{ column: 'alpha' }, { column: 'zeta', weight: 5 }]), weights),
    ).toEqual(['columns: (alpha, zeta weight 5) -> (alpha, zeta weight 10)']);
    expect(describeIndexDifferences(declared, text([{ column: 'zeta' }, { column: 'alpha' }]), new Set())).toEqual([]);
  });

  /** The language a text index stems in is a difference where the engine keeps it, `'simple'` where none is stated. */
  it("should compare a text index's language, where the engine keeps it", () => {
    const text = (config?: string) => index({ type: 'fulltext', config });
    const weights = new Set(['textIndex'] as const);
    expect(describeIndexDifferences(text(), text('english'), weights)).toEqual(['config: english -> simple']);
    expect(describeIndexDifferences(text(), text('simple'), weights)).toEqual([]);
    expect(describeIndexDifferences(text(), text('english'), new Set())).toEqual([]);
  });

  /** An unstated distance is the default one; an engine that cannot read it back compares none. */
  it('should compare a vector index distance only where the engine reads it back', () => {
    const cosine = index({ type: 'hnsw' });
    const l2 = index({ type: 'hnsw', distance: 'l2' });

    expect(describeIndexDifferences(cosine, l2, new Set(['distance']))).toEqual(['distance: l2 -> cosine']);
    expect(
      describeIndexDifferences(cosine, index({ type: 'hnsw', distance: 'cosine' }), new Set(['distance'])),
    ).toEqual([]);
    expect(describeIndexDifferences(cosine, l2, new Set())).toEqual([]);
  });

  it('should report a predicate the database has and the entity does not, either way round', () => {
    expect(describeIndexDifferences(index({}), index({ where: '"live" = true' }), new Set())).toEqual([
      'predicate: "live" = true -> none',
    ]);
    expect(describeIndexDifferences(index({ where: '"live" = true' }), index({}), new Set())).toEqual([
      'predicate: none -> "live" = true',
    ]);
  });

  /** A vector index of any type is the one index an engine has, so only a plain one standing in for it differs. */
  it('should report a plain index where a vector index is declared, and no vector type against another', () => {
    const vector = new Set(['vector'] as const);
    expect(describeIndexDifferences(index({ type: 'hnsw' }), index({}), vector)).toEqual(['vector index: no -> yes']);
    expect(describeIndexDifferences(index({ type: 'hnsw' }), index({ type: 'vector' }), vector)).toEqual([]);
  });
});

describe('indexChanges', () => {
  const table = mockTableNode('users', [{ name: 'email' }]);
  /** The table as the database holds it: these indexes. */
  const holding = (indexes: IndexNode[]) => ({ name: 'users', indexes, indexFacets: new Set<never>() });
  const emailIndex = (name: string) => ({ name, table, entries: [{ column: 'email' }], unique: true });

  /** A unique column is a unique index: its legacy `_uk` spelling is the same one, and a second is a duplicate uql made. */
  it('should keep the index a unique column is, and drop a duplicate of it', () => {
    const current = [emailIndex('users__email_uk'), emailIndex('idx_users_email')];

    expect(indexChanges([emailIndex('users__email_idx')], holding(current))).toEqual({
      changes: [{ from: emailIndex('idx_users_email') }],
      kept: [],
    });
  });

  /** Its expression cannot be compared, so the name uql derives for it is how it is known as uql's. */
  it('should drop an expression index uql named, which nothing declares anymore, and keep one named like it', () => {
    const lowered = {
      name: 'users__expr0_idx',
      table,
      entries: [{ expression: 'lower(email)' }],
      unique: false,
    };

    const handMade = { ...lowered, name: 'users__lower_email_idx' };

    expect(indexChanges([], holding([lowered, handMade]))).toEqual({
      changes: [{ from: lowered }],
      kept: [handMade],
    });
  });

  /** The engine reports a JSON path's column and keys, so the name uql derives from them is computed forwards. */
  it('should drop a JSON path index uql named, now or as an earlier uql did, and keep one named otherwise', () => {
    const pathIndex = (name: string) => ({ name, table, entries: [{ json: 'kind', path: 'name' }], unique: false });
    const derived = pathIndex('users__kind_name_idx');
    const earlier = pathIndex('users__expr0_idx');

    expect(indexChanges([], holding([derived, earlier, pathIndex('kind_name_by_dba')]))).toEqual({
      changes: [{ from: derived }, { from: earlier }],
      kept: [pathIndex('kind_name_by_dba')],
    });
  });

  /** A shortened name ends in a hash of the whole, so nothing short of the whole name derived again can claim one. */
  it('should keep a hand-made index whose long name only shares a derived lead', () => {
    const filler = 'x'.repeat(63 - 'users__tenantId__abcdef'.length);
    const lead = (entries: IndexNode['entries'], start: string) => ({
      name: `${start}${filler.slice(start.length - 'users__tenantId_'.length)}_abcdef`,
      table,
      entries,
      unique: false,
    });
    const overExpression = lead([{ column: 'tenantId' }, { expression: 'lower(email)' }], 'users__tenantId_');
    const overPath = lead([{ json: 'settings', path: 'theme' }], 'users__settings_theme_');

    expect(overExpression.name).toHaveLength(63);
    expect(indexChanges([], holding([overExpression, overPath]))).toEqual({
      changes: [],
      kept: [overExpression, overPath],
    });
  });

  /** An entity names its unique indexes as any other, and the migration builder's `unique()` with `_uk`. */
  it('should drop a unique index uql named either way', () => {
    const fromEntity = emailIndex('users__email_idx');
    const fromBuilder = emailIndex('users__email_uk');

    expect(indexChanges([], holding([fromEntity]))).toEqual({ changes: [{ from: fromEntity }], kept: [] });
    expect(indexChanges([], holding([fromBuilder]))).toEqual({ changes: [{ from: fromBuilder }], kept: [] });
  });

  it('should drop a partial index uql named, its predicate hash read off the name', () => {
    const partial = { ...emailIndex('users__email_1a2b3c_uk'), where: 'live' };

    expect(indexChanges([], holding([partial]))).toEqual({ changes: [{ from: partial }], kept: [] });
  });

  /** The predicate is named in the index's own name, so an edit to it is a new name and the old one is dropped. */
  it('should replace a partial index whose predicate changed, rather than pair it by shape', () => {
    const live = {
      name: 'users__email_1a2b3c_idx',
      table,
      entries: [{ column: 'email' }],
      unique: false,
      where: 'live',
    };
    const archived = { ...live, name: 'users__email_4d5e6f_idx', where: 'archived' };

    expect(indexChanges([archived], holding([live]))).toEqual({
      changes: [{ to: archived }, { from: live }],
      kept: [],
    });
  });

  it('should keep an index uql did not name, which may have been made outside it', () => {
    const current = [emailIndex('users__email_idx'), emailIndex('hand_made')];

    expect(indexChanges([emailIndex('users__email_idx')], holding(current)).kept).toEqual([emailIndex('hand_made')]);
  });
});

describe('indexNameStem', () => {
  /**
   * The whole reason it exists: 0.42.0 named an index `idx_User_email` and 0.42.1 derives
   * `User__email_idx` for the same one, so a database created by either must pair with itself.
   */
  it('should pair a name from before the convention moved with the one derived now', () => {
    expect(indexNameStem('idx_User_email')).toBe(indexNameStem('User__email_idx'));
  });

  /**
   * A leading marker is a prefix convention only when nothing marks the end: an index over `pk_registry`
   * is not a primary key, and keeps the table name it starts with.
   */
  it('should leave a marker that belongs to the table name alone', () => {
    expect(indexNameStem('pk_registry__x_idx')).toBe('pk_registry_x');
    expect(indexNameStem('idx_pk_registry_x')).toBe('pk_registry_x');
  });

  it('should strip one marker, not one from each end', () => {
    expect(indexNameStem('idx_User_email_idx')).toBe('idx_User_email');
  });

  it('should read either separator, since only one convention doubles it', () => {
    expect(indexNameStem('User__email_idx')).toBe(indexNameStem('idx_User_email'));
  });

  /** `generate:from-db` points at schemas uql never created, where `idx_` is the common spelling. */
  it('should read the prefix a database it did not create most often uses', () => {
    expect(indexNameStem('idx_orders_placed_at')).toBe('orders_placed_at');
  });

  it('should leave a name carrying no marker at all untouched', () => {
    expect(indexNameStem('whatever_the_dba_called_it')).toBe('whatever_the_dba_called_it');
  });
});

describe('indexSignature', () => {
  it('should recognise the same index whatever it is called', () => {
    const entries = [{ column: 'email' }];
    expect(indexSignature({ name: 'User__email_idx', entries, unique: false })).toBe(
      indexSignature({ name: 'whatever_the_dba_called_it', entries, unique: false }),
    );
  });

  /** No engine alters an index's uniqueness, so the two are different objects, not one that changed. */
  it('should tell a unique index from a plain one over the same columns', () => {
    const entries = [{ column: 'email' }];
    expect(indexSignature({ name: 'a', entries, unique: true })).not.toBe(
      indexSignature({ name: 'a', entries, unique: false }),
    );
  });

  it('should distinguish column order, which an index is defined by', () => {
    expect(indexSignature({ name: 'a', entries: [{ column: 'a' }, { column: 'b' }], unique: false })).not.toBe(
      indexSignature({ name: 'a', entries: [{ column: 'b' }, { column: 'a' }], unique: false }),
    );
  });

  /**
   * An engine reprints an expression from its parse tree, so its text never matches what was
   * declared. The name is the only handle such an index has.
   */
  it('should fall back to the name for an index whose expression it cannot compare', () => {
    const entries = [{ expression: 'lower(email)' }];
    expect(indexSignature({ name: 'User__lower_idx', entries, unique: false })).toBe(
      indexSignature({ name: 'idx_User_lower', entries, unique: false }),
    );
  });
});
