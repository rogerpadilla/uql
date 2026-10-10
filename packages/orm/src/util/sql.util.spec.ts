import { describe, expect, it } from 'vitest';
import {
  buildUpdateResult,
  derivedForeignKeyName,
  derivedIndexName,
  derivedPrimaryKeyName,
  escapeSqlId,
  isDerivedIndexName,
  isPrimaryKey,
} from './sql.util.js';

it('should name a constraint over no parts after its table alone', () => {
  expect(derivedPrimaryKeyName('users', [])).toBe('users_pk');
});

/** A string key has no successor to infer, so only a single-row write can be named by it. */
it('should name by a string key the one row it is reported for, never several', () => {
  expect(buildUpdateResult({ id: 'abc', changes: 1, insertIdSource: 'firstId' }).ids).toEqual(['abc']);
  expect(buildUpdateResult({ id: 'abc', changes: 2, insertIdSource: 'firstId' }).ids).toEqual([]);
});

it('should escape an identifier with the quote character given', () => {
  expect(escapeSqlId('table')).toBe('`table`');
  expect(escapeSqlId('table', '"')).toBe('"table"');
  expect(escapeSqlId('table', '`')).toBe('`table`');
  expect(escapeSqlId('my"table', '"')).toBe('"my""table"');
  expect(escapeSqlId('my`table', '`')).toBe('`my``table`');
  expect(escapeSqlId('schema.table')).toBe('`schema`.`table`');
  expect(escapeSqlId('schema.table', '"')).toBe('"schema"."table"');
  expect(escapeSqlId('schema.table', '"', true)).toBe('"schema.table"');
  expect(escapeSqlId('table', '`', false, true)).toBe('`table`.');
  expect(escapeSqlId('schema.table', '`', false, true)).toBe('`schema`.`table`.');
  expect(escapeSqlId('')).toBe('');
  expect(escapeSqlId(undefined)).toBe('');
});

describe('derived constraint names', () => {
  it('should name a partial index by a hash of its predicate, so an edited predicate is a new name', () => {
    const live = derivedIndexName('Order', ['total'], false, '"live" = true');

    expect(live).toMatch(/^Order__total_[0-9a-f]{6}_idx$/);
    expect(derivedIndexName('Order', ['total'], false, '"live" = true')).toBe(live);
    expect(derivedIndexName('Order', ['total'], false, '"live" = false')).not.toBe(live);
    expect(live).not.toBe(derivedIndexName('Order', ['total']));
  });

  it('should recognise a derived index name with or without a predicate hash, and no other', () => {
    const hashed = derivedIndexName('Order', ['total'], false, '"live" = true');

    expect(isDerivedIndexName('Order', ['total'], hashed)).toBe(true);
    expect(isDerivedIndexName('Order', ['total'], derivedIndexName('Order', ['total'], true))).toBe(true);
    expect(isDerivedIndexName('Order', ['total'], 'Order__total_idx')).toBe(true);
    expect(isDerivedIndexName('Order', ['total'], 'Order__total_by_dba_idx')).toBe(false);
    expect(isDerivedIndexName('Order', ['other'], hashed)).toBe(false);
  });

  it('should recognise a plain name whose column is itself six hex characters', () => {
    expect(isDerivedIndexName('Order', ['decade'], derivedIndexName('Order', ['decade']))).toBe(true);
    expect(isDerivedIndexName('Order', ['decade'], 'Order__decade_idx')).toBe(true);
  });

  it('should name each kind after the table and its columns, kind last', () => {
    expect(derivedIndexName('Order', ['total'])).toBe('Order__total_idx');
    expect(derivedIndexName('User', ['email'], true)).toBe('User__email_uk');
    // A name is one identifier, so a table's schema stays out of it.
    expect(derivedIndexName('sales.Order', ['total'])).toBe('Order__total_idx');
    expect(derivedForeignKeyName('Order', ['customerId'])).toBe('Order__customerId_fk');
    expect(derivedPrimaryKeyName('Enrolment', ['studentId', 'courseId'])).toBe('Enrolment__studentId_courseId_pk');
  });

  /**
   * Postgres and SQLite name indexes in one namespace across the whole database rather than per
   * table, so the boundary between the table and its columns is the one that has to be unambiguous.
   * A single underscore let two different tables reduce to the same name.
   */
  it('should keep two tables apart where one name is a prefix of another plus a column', () => {
    expect(derivedIndexName('user_profile', ['id'])).toBe('user_profile__id_idx');
    expect(derivedIndexName('user', ['profile_id'])).toBe('user__profile_id_idx');
    expect(derivedIndexName('user_profile', ['id'])).not.toBe(derivedIndexName('user', ['profile_id']));
  });

  /** Postgres truncates at 63 bytes and MySQL errors at 64, so nothing may reach them longer. */
  it('should keep a name within the length every engine accepts', () => {
    const name = derivedPrimaryKeyName('ProductVariantInventory', [
      'warehouseIdentifier',
      'variantIdentifier',
      'locationIdentifier',
    ]);
    expect(name.length).toBeLessThanOrEqual(63);
  });

  it('should derive the same shortened name every time, so a later run still recognises it', () => {
    const columns = ['warehouseIdentifier', 'variantIdentifier', 'locationIdentifier'];
    expect(derivedPrimaryKeyName('ProductVariantInventory', columns)).toBe(
      derivedPrimaryKeyName('ProductVariantInventory', columns),
    );
  });

  /**
   * Truncating alone would collide here - the two differ only past the cut - and a collision means
   * one constraint silently replacing another.
   */
  it('should keep two long names apart where a plain truncation would merge them', () => {
    const table = 'ProductVariantInventoryAllocation';
    const first = derivedIndexName(table, ['warehouseIdentifier', 'variantIdentifierAlpha']);
    const second = derivedIndexName(table, ['warehouseIdentifier', 'variantIdentifierOmega']);

    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(63);
    expect(second.length).toBeLessThanOrEqual(63);
  });

  it('should leave a name that already fits exactly as it is', () => {
    expect(derivedIndexName('Order', ['total'])).not.toMatch(/[0-9a-f]{6}$/);
  });
});

describe('escapeSqlId - identifier injection hardening', () => {
  it('should not break out of a double-quoted identifier with embedded quotes', () => {
    const evil = 'u"; SELECT 1; --';
    expect(escapeSqlId(evil, '"')).toBe('"u""; SELECT 1; --"');
  });

  it('should not break out of a backtick-quoted identifier', () => {
    const evil = 't`; DROP TABLE x; --';
    expect(escapeSqlId(evil, '`')).toBe('`t``; DROP TABLE x; --`');
  });

  it('should keep a single quote inside a quoted identifier as it is', () => {
    expect(escapeSqlId("users' OR 1=1", '"')).toBe('"users\' OR 1=1"');
  });

  it('should keep a NULL byte inside a quoted identifier', () => {
    expect(escapeSqlId('users\u0000', '"')).toBe('"users\u0000"');
  });

  it('should qualify each segment so dots in malicious names stay inside quotes', () => {
    const evil = 'a.b"; --';
    expect(escapeSqlId(evil, '"')).toBe('"a"."b""; --"');
  });
});

describe('buildUpdateResult', () => {
  it('should handle MySQL "firstId" source', () => {
    const res = buildUpdateResult({
      changes: 3,
      id: 10,
      insertIdSource: 'firstId',
    });
    expect(res).toEqual({
      changes: 3,
      ids: [10, 11, 12],
      created: undefined,
    });
  });

  it('should apply an auto-increment stride > 1 (clustered MySQL)', () => {
    const res = buildUpdateResult({ changes: 3, id: 10, insertIdSource: 'firstId', insertIdIncrement: 2 });
    expect(res.ids).toEqual([10, 12, 14]);
    expect(res.ids?.[0]).toBe(10);
    const big = buildUpdateResult({ changes: 3, id: 10n, insertIdSource: 'firstId', insertIdIncrement: 3 });
    expect(big.ids).toEqual([10n, 13n, 16n]);
  });

  it('should ignore a zero header id (no auto-generated key, e.g. mysql2 insertId=0)', () => {
    const res = buildUpdateResult({
      changes: 3,
      id: '0',
      insertIdSource: 'firstId',
    });
    expect(res).toEqual({
      changes: 3,
      ids: [],
      created: undefined,
    });
    expect(buildUpdateResult({ changes: 2, id: 0n, insertIdSource: 'firstId' }).ids).toEqual([]);
  });

  it('should ignore the header id on "returning" dialects (rows are the source of truth)', () => {
    const res = buildUpdateResult({
      changes: 2,
      id: '7',
      insertIdSource: 'returning',
    });
    expect(res).toEqual({
      changes: 2,
      ids: [],
      created: undefined,
    });
    const withRows = buildUpdateResult({
      rows: [{ id: 5 }, { id: 9 }],
      insertIdSource: 'returning',
    });
    expect(withRows.ids).toEqual([5, 9]);
    expect(withRows.ids?.[0]).toBe(5);
  });

  it('should return empty ids when no id or rows provided', () => {
    const res = buildUpdateResult({ changes: 5 });
    expect(res.ids).toEqual([]);
    expect(res.ids?.[0]).toBeUndefined();
  });
});

describe('isPrimaryKey', () => {
  it('should return true for valid primary key types', () => {
    expect(isPrimaryKey('foo')).toBe(true);
    expect(isPrimaryKey(123)).toBe(true);
    expect(isPrimaryKey(0)).toBe(true);
    expect(isPrimaryKey(100n)).toBe(true);
    expect(isPrimaryKey('')).toBe(true);
  });

  it('should return false for invalid types', () => {
    expect(isPrimaryKey(null)).toBe(false);
    expect(isPrimaryKey(undefined)).toBe(false);
    expect(isPrimaryKey({})).toBe(false);
    expect(isPrimaryKey([])).toBe(false);
    expect(isPrimaryKey(true)).toBe(false);
  });
});
