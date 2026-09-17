import { describe, expect, it } from 'vitest';
import type { Item } from '../test/index.js';
import type { RawRow } from '../type/index.js';
import {
  buildUpdateResult,
  derivedCheckName,
  derivedConstraintName,
  derivedForeignKeyName,
  derivedIndexName,
  derivedPrimaryKeyName,
  escapeSqlId,
  isPrimaryKey,
  obtainAttrsPaths,
  unflatObject,
  unflatObjects,
} from './sql.util.js';

it('should name a constraint over no parts after its table alone', () => {
  expect(derivedConstraintName('users', [], 'ck')).toBe('users_ck');
});

/** A string key has no successor to infer, so only a single-row write can be named by it. */
it('should infer no ids from a string key reported for several rows', () => {
  expect(buildUpdateResult({ id: 'abc', changes: 2, insertIdSource: 'firstId' }).ids).toEqual([]);
});

it('should leave an empty list of rows as it is', () => {
  expect(unflatObjects([])).toEqual([]);
});

it('should unflatten dotted columns into nested objects', () => {
  const source: RawRow[] = [
    {
      id: '1',
      name: 'Auxiliar',
      address: null,
      description: null,
      createdAt: 1,
      updatedAt: null,
      creatorId: '1',
      companyId: '1',
    },
    {
      id: '2',
      name: 'Principal',
      address: null,
      description: null,
      createdAt: 1,
      updatedAt: 1578759519913,
      creatorId: '1',
      companyId: '1',
    },
  ];
  const result = unflatObjects(source);
  const expected = [
    {
      id: '1',
      name: 'Auxiliar',
      address: null,
      description: null,
      createdAt: 1,
      updatedAt: null,
      creatorId: '1',
      companyId: '1',
    },
    {
      id: '2',
      name: 'Principal',
      address: null,
      description: null,
      createdAt: 1,
      updatedAt: 1578759519913,
      creatorId: '1',
      companyId: '1',
    },
  ];
  expect(result).toEqual(expected);
});

it('should unflatten deeply nested dotted columns', () => {
  const source = [
    {
      id: '9',
      buyPrice: 1000,
      number: 10,
      'item.id': '1',
      'item.name': 'Arepa de Yuca y Queso x 6',
      'item.createdAt': 1,
      'item.buyLedgerAccount': 1,
      'item.saleLedgerAccount': 1,
      'item.tax': 1,
      'item.companyId': '1',
      'item.measureUnit': 1,
      'item.inventoryable': 1,
      'item.buyLedgerAccount.id': '1',
      'item.buyLedgerAccount.name': 'Ventas',
      'item.saleLedgerAccount.id': '1',
      'item.saleLedgerAccount.name': 'Ventas',
      'item.tax.id': '1',
      'item.tax.name': 'IVA 0%',
      'item.tax.percentage': 0,
      'item.tax.category.pk': '1',
      'item.tax.category.name': 'Impuestos',
      'item.tax.category.description': 'Nacionales',
      'item.measureUnit.id': '1',
      'item.measureUnit.name': 'Unidad',
      'item.creatorId': null,
      'item.creator.id': null,
      'item.creator.name': null,
    },
    {
      id: '15',
      buyPrice: 2000,
      number: 20,
      'item.id': '2',
      'item.name': 'Pony Malta 2 litros',
      'item.createdAt': 1,
      'item.companyId': '1',
      'item.creatorId': '5',
      'item.creator.id': '5',
      'item.creator.name': 'Roshi Master',
    },
  ];
  const result = unflatObjects<Item>(source);
  const expected = [
    {
      id: '9',
      buyPrice: 1000,
      number: 10,
      item: {
        id: '1',
        name: 'Arepa de Yuca y Queso x 6',
        createdAt: 1,
        buyLedgerAccount: {
          id: '1',
          name: 'Ventas',
        },
        saleLedgerAccount: {
          id: '1',
          name: 'Ventas',
        },
        tax: {
          id: '1',
          name: 'IVA 0%',
          percentage: 0,
          category: {
            pk: '1',
            name: 'Impuestos',
            description: 'Nacionales',
          },
        },
        companyId: '1',
        measureUnit: {
          id: '1',
          name: 'Unidad',
        },
        inventoryable: 1,
      },
    },
    {
      id: '15',
      buyPrice: 2000,
      number: 20,
      item: {
        id: '2',
        name: 'Pony Malta 2 litros',
        createdAt: 1,
        companyId: '1',
        creatorId: '5',
        creator: {
          id: '5',
          name: 'Roshi Master',
        },
      },
    },
  ];
  expect(result).toEqual(expected);
});

it('should find no paths in an empty row', () => {
  expect(obtainAttrsPaths({})).toEqual({});
});

it('should split dotted keys into paths, skipping the rest', () => {
  const res1 = obtainAttrsPaths({
    'prop1.a.b': 1,
    'prop2.c': 2,
    prop_3: 3,
  });
  expect(res1).toEqual({
    'prop1.a.b': ['prop1', 'a', 'b'],
    'prop2.c': ['prop2', 'c'],
  });
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
  it('should name each kind after the table and its columns, kind last', () => {
    expect(derivedIndexName('Order', ['total'])).toBe('Order__total_idx');
    expect(derivedIndexName('User', ['email'], true)).toBe('User__email_uk');
    expect(derivedForeignKeyName('Order', ['customerId'])).toBe('Order__customerId_fk');
    expect(derivedPrimaryKeyName('Enrolment', ['studentId', 'courseId'])).toBe('Enrolment__studentId_courseId_pk');
    expect(derivedCheckName('Order', 1)).toBe('Order__1_ck');
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

  it('should qualify each segment so dots in malicious names stay inside quotes', () => {
    const evil = 'a.b"; --';
    expect(escapeSqlId(evil, '"')).toBe('"a"."b""; --"');
  });
});

it('should leave underscored keys out of the paths', () => {
  const res1 = obtainAttrsPaths({
    prop1_a_b: 1,
    USER_ID: 2,
    user_id: 3,
  });
  // Underscores are NOT treated as path delimiters (they can appear in property names)
  expect(res1).toEqual({});
});

it('should leave underscored keys flat', () => {
  const source = [
    {
      user_id: 1,
      user_name: 'John',
      USER_ROLE: 'admin',
    },
  ];
  const result = unflatObjects(source);
  // Underscore columns stay flat (they are NOT treated as nested paths)
  expect(result).toEqual([
    {
      user_id: 1,
      user_name: 'John',
      USER_ROLE: 'admin',
    },
  ]);
});

it('should leave a flat row as it is', () => {
  const attrsPaths = obtainAttrsPaths({ id: 1, name: 'John' });
  const result = unflatObject<{ id: number; name: string }>({ id: 1, name: 'John' }, attrsPaths);
  expect(result).toEqual({ id: 1, name: 'John' });
});

it('should unflatten a deeply nested row', () => {
  const row = {
    id: '1',
    'item.id': '10',
    'item.name': 'Widget',
    'item.category.name': 'Tools',
  };
  const attrsPaths = obtainAttrsPaths(row);
  const result = unflatObject(row, attrsPaths);
  expect(result).toEqual({
    id: '1',
    item: {
      id: '10',
      name: 'Widget',
      category: { name: 'Tools' },
    },
  });
});

it('should skip null values', () => {
  const row = { id: 1, name: null, 'item.id': null };
  const attrsPaths = obtainAttrsPaths(row);
  const result = unflatObject(row, attrsPaths);
  expect(result).toEqual({ id: 1 });
});

it('should unflatten a single row as unflatObjects does', () => {
  const row = {
    id: '5',
    'item.id': '2',
    'item.name': 'Test',
    'item.tax.name': 'IVA',
  };
  const attrsPaths = obtainAttrsPaths(row);
  const single = unflatObject(row, attrsPaths);
  const batched = unflatObjects([row])[0];
  expect(single).toEqual(batched);
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
      firstId: 10,
      created: undefined,
    });
  });

  it('should apply an auto-increment stride > 1 (clustered MySQL)', () => {
    const res = buildUpdateResult({ changes: 3, id: 10, insertIdSource: 'firstId', insertIdIncrement: 2 });
    expect(res.ids).toEqual([10, 12, 14]);
    expect(res.firstId).toBe(10);
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
      firstId: undefined,
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
      firstId: undefined,
      created: undefined,
    });
    const withRows = buildUpdateResult({
      rows: [{ id: 5 }, { id: 9 }],
      insertIdSource: 'returning',
    });
    expect(withRows.ids).toEqual([5, 9]);
    expect(withRows.firstId).toBe(5);
  });

  it('should detect created status from upsertStatus', () => {
    expect(buildUpdateResult({ upsertStatus: 1 }).created).toBe(true);
    expect(buildUpdateResult({ upsertStatus: 2 }).created).toBe(false);
    expect(buildUpdateResult({ upsertStatus: 0 }).created).toBe(false);
    expect(buildUpdateResult({ upsertStatus: undefined }).created).toBe(undefined);
  });

  it('should ignore upsertStatus for RETURNING dialects without a `_created` column', () => {
    // MariaDB's `ON DUPLICATE KEY UPDATE ... RETURNING` doesn't follow the MySQL 1/2/0
    // affectedRows convention (driver-dependent, sometimes non-numeric, sometimes a stale/wrong
    // value); treating it as a `created` signal produced a real false positive/negative on insert.
    expect(buildUpdateResult({ insertIdSource: 'returning', upsertStatus: 1 }).created).toBeUndefined();
    expect(buildUpdateResult({ insertIdSource: 'returning', upsertStatus: 2 }).created).toBeUndefined();
    expect(buildUpdateResult({ insertIdSource: 'returning', upsertStatus: 0 }).created).toBeUndefined();
  });

  it('should return empty ids when no id or rows provided', () => {
    const res = buildUpdateResult({ changes: 5 });
    expect(res.ids).toEqual([]);
    expect(res.firstId).toBeUndefined();
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
