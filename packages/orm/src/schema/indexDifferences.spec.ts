import { describe, expect, it } from 'vitest';
import { mockTableNode } from '../test/index.js';
import { describeIndexDifferences, indexNameStem, indexSignature } from './indexDifferences.js';
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
  });

  /** A vector index of any type is the one index an engine has, so only a plain one standing in for it differs. */
  it('should report a plain index where a vector index is declared, and no vector type against another', () => {
    const vector = new Set(['vector'] as const);
    expect(describeIndexDifferences(index({ type: 'hnsw' }), index({}), vector)).toEqual(['vector index: no -> yes']);
    expect(describeIndexDifferences(index({ type: 'hnsw' }), index({ type: 'vector' }), vector)).toEqual([]);
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
    const entries = [{ column: 'lower(email)', expression: true }];
    expect(indexSignature({ name: 'User__lower_idx', entries, unique: false })).toBe(
      indexSignature({ name: 'idx_User_lower', entries, unique: false }),
    );
  });
});
