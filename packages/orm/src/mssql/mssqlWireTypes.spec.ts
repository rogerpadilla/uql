import { describe, expect, it } from 'vitest';
import { decodeWireTypes } from './mssqlWireTypes.js';

/** The shape `tedious` reports: a column's type is its factory function. */
const columnsOf = (types: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(types).map(([name, type]) => [
      name,
      { type: Object.defineProperty(() => 0, 'name', { value: type }) },
    ]),
  );

describe('decodeWireTypes', () => {
  it('should decode a BIGINT to a number and leave every other column alone', () => {
    const rows = [{ id: '9', total: '1.50', n: 3 }];
    const columns = columnsOf({ id: 'BigInt', total: 'Decimal', n: 'Int' });

    expect(decodeWireTypes(rows, columns)).toEqual([{ id: 9, total: '1.50', n: 3 }]);
  });

  /** Past 2^53 a number cannot represent the value, so the exact text the driver gave is kept. */
  it('should keep a value no number can hold', () => {
    const columns = columnsOf({ id: 'BigInt' });

    expect(decodeWireTypes([{ id: '9007199254740991' }], columns)).toEqual([{ id: 9007199254740991 }]);
    expect(decodeWireTypes([{ id: '9007199254740993' }], columns)).toEqual([{ id: '9007199254740993' }]);
  });

  it('should return the rows untouched when no column needs decoding', () => {
    const rows = [{ n: 1 }];

    expect(decodeWireTypes(rows, columnsOf({ n: 'Int' }))).toBe(rows);
  });

  it('should answer an empty list for nothing to decode', () => {
    expect(decodeWireTypes(undefined, columnsOf({ id: 'BigInt' }))).toEqual([]);
    expect(decodeWireTypes([{ id: '1' }], undefined)).toEqual([{ id: '1' }]);
  });

  /** A NULL stays NULL: only a string is a candidate, since that is how the driver spells the type. */
  it('should leave a null and an already-numeric value as they are', () => {
    const columns = columnsOf({ id: 'BigInt' });

    expect(decodeWireTypes([{ id: null }, { id: 7 }], columns)).toEqual([{ id: null }, { id: 7 }]);
  });
});
