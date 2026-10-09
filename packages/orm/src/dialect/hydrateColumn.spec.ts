import { describe, expect, it } from 'vitest';
import { DECODERS } from './hydrateColumn.js';

/**
 * Decoding one cell by its column's kind. Drivers disagree on which columns arrive already decoded, so
 * every branch is a no-op on a value the driver decoded itself.
 */
describe('DECODERS', () => {
  it('should turn an engine without a boolean type back into one', () => {
    expect(DECODERS.boolean(1)).toBe(true);
    expect(DECODERS.boolean(0)).toBe(false);
  });

  it('should leave a boolean the driver already decoded', () => {
    expect(DECODERS.boolean(true)).toBe(true);
    expect(DECODERS.boolean(false)).toBe(false);
  });

  it('should read a timestamp that crossed JSON, cutting a fraction finer than a Date holds', () => {
    expect(DECODERS.date('2026-09-10T12:30:00.123+00:00')).toEqual(new Date(Date.UTC(2026, 8, 10, 12, 30, 0, 123)));
    expect(DECODERS.date('2026-09-10T12:30:00.123456Z')).toEqual(new Date(Date.UTC(2026, 8, 10, 12, 30, 0, 123)));
  });

  it('should read a timestamp naming no zone as UTC, in any spelling an engine gives it', () => {
    const at = new Date(Date.UTC(2026, 8, 10, 12, 30, 0, 123));
    expect(DECODERS.date('2026-09-10 12:30:00.123')).toEqual(at);
    expect(DECODERS.date('2026-09-10T12:30:00.123456')).toEqual(at);
    expect(DECODERS.date('2026-09-10T21:30:00.123+09:00')).toEqual(at);
    expect(DECODERS.date('2026-09-10 12:30:00')).toEqual(new Date(Date.UTC(2026, 8, 10, 12, 30)));
  });

  it('should read a bare date at UTC midnight, as `new Date` parses one', () => {
    expect(DECODERS.date('2026-09-10')).toEqual(new Date(Date.UTC(2026, 8, 10)));
  });

  it('should leave a Date the driver already decoded, and text that is no date', () => {
    const date = new Date();
    expect(DECODERS.date(date)).toBe(date);
    expect(DECODERS.date('12:30:00')).toBe('12:30:00');
  });

  it('should read bytes that crossed JSON in their hex form, and leave bytes already decoded', () => {
    expect(DECODERS.bytes('\\x6869')).toEqual(new Uint8Array([0x68, 0x69]));
    const bytes = new Uint8Array([1, 2]);
    expect(DECODERS.bytes(bytes)).toBe(bytes);
  });

  it('should read a wide integer or a decimal returned as text', () => {
    expect(DECODERS.number('9')).toBe(9);
    expect(DECODERS.number('12.50')).toBe(12.5);
    expect(DECODERS.number('-0.5')).toBe(-0.5);
  });

  it('should leave a number the driver already decoded, and text that is not one', () => {
    expect(DECODERS.number(9)).toBe(9);
    expect(DECODERS.number('not a number')).toBe('not a number');
  });

  it('should keep the exact text of a number past 2^53, where a number would round', () => {
    const bytes = (text: string) => new TextEncoder().encode(text);
    expect(DECODERS.number('9007199254740993')).toBe('9007199254740993');
    expect(DECODERS.number(bytes('12345678901234567890.99'))).toBe('12345678901234567890.99');
  });

  it('should read text a driver handed over as bytes', () => {
    // `bun:sql` returns a MySQL DECIMAL, and any SUM over one, as a Buffer of its digits.
    const bytes = (text: string) => new TextEncoder().encode(text);
    expect(DECODERS.number(bytes('500'))).toBe(500);
    expect(DECODERS.number(bytes('12.50'))).toBe(12.5);
    expect(DECODERS.bigint(bytes('9007199254740993'))).toBe(9007199254740993n);
    expect(DECODERS.json(bytes('{"a":1}'))).toEqual({ a: 1 });
    expect(DECODERS.vector(bytes('[1,0,2]'))).toEqual([1, 0, 2]);
  });

  it('should restore a bigint field from either shape a driver hands back', () => {
    // The pg pools decode BIGINT to a JS number at the wire, so this undoes that for `type: BigInt`.
    expect(DECODERS.bigint(9)).toBe(9n);
    expect(DECODERS.bigint('9007199254740993')).toBe(9007199254740993n);
    expect(DECODERS.bigint(9n)).toBe(9n);
  });

  it('should keep a value that is no integer at all rather than throwing', () => {
    // `BigInt(1.5)` and `BigInt('x')` both throw; a refused decode must not take the read with it.
    expect(DECODERS.bigint(1.5)).toBe(1.5);
    expect(DECODERS.bigint('x')).toBe('x');
  });

  it('should parse a JSON column, and keep non-JSON text as it came', () => {
    expect(DECODERS.json('{"a":1}')).toEqual({ a: 1 });
    expect(DECODERS.json('not json')).toBe('not json');
  });

  it('should leave JSON a driver already parsed', () => {
    const parsed = { a: 1 };
    expect(DECODERS.json(parsed)).toBe(parsed);
  });

  it('should read a vector by the cast its column was written with', () => {
    expect(DECODERS.vector('[1,0,2]')).toEqual([1, 0, 2]);
    expect(DECODERS.sparsevec('{1:1,3:2}/3')).toEqual([1, 0, 2]);
    expect(DECODERS.halfvec('[1,0,2]')).toEqual([1, 0, 2]);
  });

  /** MariaDB's `VEC_ToText` keeps six digits, so its vectors cross as their packed float32s instead. */
  it('should read a vector packed as little-endian float32s in hex, every digit kept', () => {
    expect(DECODERS.vector('\\xDED6FC3DDB0F49400000003F000000C0')).toEqual([0.1234567, 3.1415927, 0.5, -2]);
  });

  /** A SQLite blob column, in each shape its drivers hand one over. */
  it('should read a float32 column from the bytes a SQLite driver returns', () => {
    const packed = new Float32Array([1, 0.5, -2]);
    expect(DECODERS.float32(new Uint8Array(packed.buffer))).toEqual([1, 0.5, -2]);
    expect(DECODERS.float32(packed.buffer)).toEqual([1, 0.5, -2]);
  });

  it('should read a float32 column that crossed JSON as hex, or was stored as text before blobs', () => {
    expect(DECODERS.float32('\\x0000803F000000C0')).toEqual([1, -2]);
    expect(DECODERS.float32('[1,0,2]')).toEqual([1, 0, 2]);
  });

  it('should keep text that is not that column’s literal', () => {
    expect(DECODERS.sparsevec('[1,2]')).toBe('[1,2]');
  });
});
