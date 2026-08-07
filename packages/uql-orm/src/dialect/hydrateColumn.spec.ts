import { describe, expect, it } from 'vitest';
import { decodeColumn } from './hydrateColumn.js';

/**
 * Decoding one cell, given the kind its column was classified as.
 *
 * Every case here is "the driver already did it" or "the driver could not". Which of the two a given
 * type falls into varies per driver, so each branch has to be a no-op on an already-decoded value:
 * the same entity is read through node-postgres, mysql2, `bun:sql` and better-sqlite3, and they
 * disagree about which columns arrive as text.
 */
describe('decodeColumn', () => {
  it('turns an engine without a boolean type back into one', () => {
    expect(decodeColumn(1, 'boolean')).toBe(true);
    expect(decodeColumn(0, 'boolean')).toBe(false);
  });

  it('leaves a boolean the driver already decoded', () => {
    expect(decodeColumn(true, 'boolean')).toBe(true);
    expect(decodeColumn(false, 'boolean')).toBe(false);
  });

  it('reads a wide integer or a decimal returned as text', () => {
    expect(decodeColumn('9', 'number')).toBe(9);
    expect(decodeColumn('12.50', 'number')).toBe(12.5);
    expect(decodeColumn('-0.5', 'number')).toBe(-0.5);
  });

  it('leaves a number the driver already decoded, and text that is not one', () => {
    expect(decodeColumn(9, 'number')).toBe(9);
    expect(decodeColumn('not a number', 'number')).toBe('not a number');
  });

  it('reads text a driver handed over as bytes', () => {
    // `bun:sql` returns a MySQL DECIMAL, and any SUM over one, as a Buffer of its digits.
    const bytes = (text: string) => new TextEncoder().encode(text);
    expect(decodeColumn(bytes('500'), 'number')).toBe(500);
    expect(decodeColumn(bytes('12.50'), 'number')).toBe(12.5);
    expect(decodeColumn(bytes('9007199254740993'), 'bigint')).toBe(9007199254740993n);
    expect(decodeColumn(bytes('{"a":1}'), 'json')).toEqual({ a: 1 });
    expect(decodeColumn(bytes('[1,0,2]'), 'vector')).toEqual([1, 0, 2]);
  });

  it('restores a bigint field from either shape a driver hands back', () => {
    // The pg pools decode BIGINT to a JS number at the wire, so this undoes that for `type: BigInt`.
    expect(decodeColumn(9, 'bigint')).toBe(9n);
    expect(decodeColumn('9007199254740993', 'bigint')).toBe(9007199254740993n);
    expect(decodeColumn(9n, 'bigint')).toBe(9n);
  });

  it('keeps a value that is no integer at all rather than throwing', () => {
    // `BigInt(1.5)` and `BigInt('x')` both throw; a refused decode must not take the read with it.
    expect(decodeColumn(1.5, 'bigint')).toBe(1.5);
    expect(decodeColumn('x', 'bigint')).toBe('x');
  });

  it('parses a JSON column, and keeps non-JSON text as it came', () => {
    expect(decodeColumn('{"a":1}', 'json')).toEqual({ a: 1 });
    expect(decodeColumn('not json', 'json')).toBe('not json');
  });

  it('leaves JSON a driver already parsed', () => {
    const parsed = { a: 1 };
    expect(decodeColumn(parsed, 'json')).toBe(parsed);
  });

  it('reads a vector by the cast its column was written with', () => {
    expect(decodeColumn('[1,0,2]', 'vector')).toEqual([1, 0, 2]);
    expect(decodeColumn('{1:1,3:2}/3', 'sparsevec')).toEqual([1, 0, 2]);
    expect(decodeColumn('[1,0,2]', 'halfvec')).toEqual([1, 0, 2]);
  });

  it('keeps text that is not that column’s literal', () => {
    expect(decodeColumn('[1,2]', 'sparsevec')).toBe('[1,2]');
  });
});
