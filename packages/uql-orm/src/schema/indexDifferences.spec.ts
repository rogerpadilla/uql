import { describe, expect, it } from 'vitest';
import { indexNameStem, indexSignature } from './indexDifferences.js';

describe('indexNameStem', () => {
  /**
   * The whole reason it exists: 0.42.0 named an index `idx_User_email` and 0.42.1 derives
   * `User__email_idx` for the same one, so a database created by either must pair with itself.
   */
  it('pairs a name from before the convention moved with the one derived now', () => {
    expect(indexNameStem('idx_User_email')).toBe(indexNameStem('User__email_idx'));
  });

  /**
   * A leading marker is only the old convention when nothing marks the end. Stripping both would eat
   * a prefix belonging to the table - an index over `pk_registry` is not a primary key - and leave
   * that table unable to recognise its own older name.
   */
  it('leaves a marker that belongs to the table name alone', () => {
    expect(indexNameStem('pk_registry__x_idx')).toBe('pk_registry_x');
    expect(indexNameStem('idx_pk_registry_x')).toBe('pk_registry_x');
  });

  it('strips one marker, not one from each end', () => {
    expect(indexNameStem('idx_User_email_idx')).toBe('idx_User_email');
  });

  it('reads either separator, since only one convention doubles it', () => {
    expect(indexNameStem('User__email_idx')).toBe(indexNameStem('idx_User_email'));
  });

  /** `generate:from-db` points at schemas uql never created, where `idx_` is the common spelling. */
  it('reads the prefix a database it did not create most often uses', () => {
    expect(indexNameStem('idx_orders_placed_at')).toBe('orders_placed_at');
  });

  it('leaves a name carrying no marker at all untouched', () => {
    expect(indexNameStem('whatever_the_dba_called_it')).toBe('whatever_the_dba_called_it');
  });
});

describe('indexSignature', () => {
  it('recognises the same index whatever it is called', () => {
    const entries = [{ column: 'email' }];
    expect(indexSignature({ name: 'User__email_idx', entries, unique: false })).toBe(
      indexSignature({ name: 'whatever_the_dba_called_it', entries, unique: false }),
    );
  });

  /** No engine alters an index's uniqueness, so the two are different objects, not one that changed. */
  it('tells a unique index from a plain one over the same columns', () => {
    const entries = [{ column: 'email' }];
    expect(indexSignature({ name: 'a', entries, unique: true })).not.toBe(
      indexSignature({ name: 'a', entries, unique: false }),
    );
  });

  it('distinguishes column order, which an index is defined by', () => {
    expect(indexSignature({ name: 'a', entries: [{ column: 'a' }, { column: 'b' }], unique: false })).not.toBe(
      indexSignature({ name: 'a', entries: [{ column: 'b' }, { column: 'a' }], unique: false }),
    );
  });

  /**
   * An engine reprints an expression from its parse tree, so its text never matches what was
   * declared. The name is the only handle such an index has.
   */
  it('falls back to the name for an index whose expression it cannot compare', () => {
    const entries = [{ column: 'lower(email)', expression: true }];
    expect(indexSignature({ name: 'User__lower_idx', entries, unique: false })).toBe(
      indexSignature({ name: 'idx_User_lower', entries, unique: false }),
    );
  });
});
