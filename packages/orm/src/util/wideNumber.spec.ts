import { describe, expect, it } from 'vitest';
import { decodeBigInts, decodeWideNumber } from './wideNumber.js';

describe('decodeWideNumber', () => {
  it('should answer a number wherever one is exact', () => {
    expect(decodeWideNumber('9')).toBe(9);
    expect(decodeWideNumber(9n)).toBe(9);
    expect(decodeWideNumber('12.50')).toBe(12.5);
    expect(decodeWideNumber(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('should answer the exact text past 2^53, where a number would round', () => {
    expect(decodeWideNumber('9007199254740993')).toBe('9007199254740993');
    expect(decodeWideNumber(9007199254740993n)).toBe('9007199254740993');
    expect(decodeWideNumber(-9007199254740993n)).toBe('-9007199254740993');
    expect(decodeWideNumber('12345678901234567890.99')).toBe('12345678901234567890.99');
  });
});

describe('decodeBigInts', () => {
  it('should decode every bigint cell in place, and leave the rest alone', () => {
    const row = { id: 5n, big: 9007199254740993n, name: 'a', total: 3 };

    expect(decodeBigInts(row)).toBe(row);
    expect(row).toEqual({ id: 5, big: '9007199254740993', name: 'a', total: 3 });
  });
});
