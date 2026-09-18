import { describe, expect, it } from 'vitest';
import { decodeColumn } from './hydrateColumn.js';

/**
 * Decoding one cell by its column's kind. Drivers disagree on which columns arrive already decoded, so
 * every branch is a no-op on a value the driver decoded itself.
 */
describe('decodeColumn', () => {
  it('should turn an engine without a boolean type back into one', () => {
    expect(decodeColumn(1, 'boolean')).toBe(true);
    expect(decodeColumn(0, 'boolean')).toBe(false);
  });

  it('should leave a boolean the driver already decoded', () => {
    expect(decodeColumn(true, 'boolean')).toBe(true);
    expect(decodeColumn(false, 'boolean')).toBe(false);
  });

  it('should read a timestamp that crossed JSON, cutting a fraction finer than a Date holds', () => {
    expect(decodeColumn('2026-09-10T12:30:00.123+00:00', 'date')).toEqual(
      new Date(Date.UTC(2026, 8, 10, 12, 30, 0, 123)),
    );
    expect(decodeColumn('2026-09-10T12:30:00.123456Z', 'date')).toEqual(
      new Date(Date.UTC(2026, 8, 10, 12, 30, 0, 123)),
    );
  });

  it('should read a bare date at local midnight, as pg does', () => {
    expect(decodeColumn('2026-09-10', 'date')).toEqual(new Date(2026, 8, 10));
  });

  it('should leave a Date the driver already decoded, and text that is no date', () => {
    const date = new Date();
    expect(decodeColumn(date, 'date')).toBe(date);
    expect(decodeColumn('12:30:00', 'date')).toBe('12:30:00');
  });

  it('should read bytes that crossed JSON in their hex form, and leave bytes already decoded', () => {
    expect(decodeColumn('\\x6869', 'bytes')).toEqual(new Uint8Array([0x68, 0x69]));
    const bytes = new Uint8Array([1, 2]);
    expect(decodeColumn(bytes, 'bytes')).toBe(bytes);
  });

  it('should read a wide integer or a decimal returned as text', () => {
    expect(decodeColumn('9', 'number')).toBe(9);
    expect(decodeColumn('12.50', 'number')).toBe(12.5);
    expect(decodeColumn('-0.5', 'number')).toBe(-0.5);
  });

  it('should leave a number the driver already decoded, and text that is not one', () => {
    expect(decodeColumn(9, 'number')).toBe(9);
    expect(decodeColumn('not a number', 'number')).toBe('not a number');
  });

  it('should keep the exact text of a number past 2^53, where a number would round', () => {
    const bytes = (text: string) => new TextEncoder().encode(text);
    expect(decodeColumn('9007199254740993', 'number')).toBe('9007199254740993');
    expect(decodeColumn(bytes('12345678901234567890.99'), 'number')).toBe('12345678901234567890.99');
  });

  it('should read text a driver handed over as bytes', () => {
    // `bun:sql` returns a MySQL DECIMAL, and any SUM over one, as a Buffer of its digits.
    const bytes = (text: string) => new TextEncoder().encode(text);
    expect(decodeColumn(bytes('500'), 'number')).toBe(500);
    expect(decodeColumn(bytes('12.50'), 'number')).toBe(12.5);
    expect(decodeColumn(bytes('9007199254740993'), 'bigint')).toBe(9007199254740993n);
    expect(decodeColumn(bytes('{"a":1}'), 'json')).toEqual({ a: 1 });
    expect(decodeColumn(bytes('[1,0,2]'), 'vector')).toEqual([1, 0, 2]);
  });

  it('should restore a bigint field from either shape a driver hands back', () => {
    // The pg pools decode BIGINT to a JS number at the wire, so this undoes that for `type: BigInt`.
    expect(decodeColumn(9, 'bigint')).toBe(9n);
    expect(decodeColumn('9007199254740993', 'bigint')).toBe(9007199254740993n);
    expect(decodeColumn(9n, 'bigint')).toBe(9n);
  });

  it('should keep a value that is no integer at all rather than throwing', () => {
    // `BigInt(1.5)` and `BigInt('x')` both throw; a refused decode must not take the read with it.
    expect(decodeColumn(1.5, 'bigint')).toBe(1.5);
    expect(decodeColumn('x', 'bigint')).toBe('x');
  });

  it('should parse a JSON column, and keep non-JSON text as it came', () => {
    expect(decodeColumn('{"a":1}', 'json')).toEqual({ a: 1 });
    expect(decodeColumn('not json', 'json')).toBe('not json');
  });

  it('should leave JSON a driver already parsed', () => {
    const parsed = { a: 1 };
    expect(decodeColumn(parsed, 'json')).toBe(parsed);
  });

  it('should read a vector by the cast its column was written with', () => {
    expect(decodeColumn('[1,0,2]', 'vector')).toEqual([1, 0, 2]);
    expect(decodeColumn('{1:1,3:2}/3', 'sparsevec')).toEqual([1, 0, 2]);
    expect(decodeColumn('[1,0,2]', 'halfvec')).toEqual([1, 0, 2]);
  });

  /** MariaDB's `VEC_ToText` keeps six digits, so its vectors cross as their packed float32s instead. */
  it('should read a vector packed as little-endian float32s in hex, every digit kept', () => {
    expect(decodeColumn('\\xDED6FC3DDB0F49400000003F000000C0', 'vector')).toEqual([0.1234567, 3.1415927, 0.5, -2]);
  });

  /** A SQLite blob column, in each shape its drivers hand one over. */
  it('should read a float32 column from the bytes a SQLite driver returns', () => {
    const packed = new Float32Array([1, 0.5, -2]);
    expect(decodeColumn(new Uint8Array(packed.buffer), 'float32')).toEqual([1, 0.5, -2]);
    expect(decodeColumn(packed.buffer, 'float32')).toEqual([1, 0.5, -2]);
  });

  it('should read a float32 column that crossed JSON as hex, or was stored as text before blobs', () => {
    expect(decodeColumn('\\x0000803F000000C0', 'float32')).toEqual([1, -2]);
    expect(decodeColumn('[1,0,2]', 'float32')).toEqual([1, 0, 2]);
  });

  it('should keep text that is not that column’s literal', () => {
    expect(decodeColumn('[1,2]', 'sparsevec')).toBe('[1,2]');
  });
});
