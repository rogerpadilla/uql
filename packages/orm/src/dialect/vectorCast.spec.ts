import { describe, expect, it } from 'vitest';
import { decodeFloat32s, encodeFloat32s, parseVectorLiteral } from './vectorCast.js';

describe('parseVectorLiteral', () => {
  it('should read a dense literal of numbers', () => {
    expect(parseVectorLiteral(' [1,0,2] ', 'vector')).toEqual([1, 0, 2]);
  });

  /** Valid JSON is not enough: a vector holds numbers, so anything else is left as the raw text. */
  it('should refuse a dense literal holding anything but numbers', () => {
    expect(parseVectorLiteral('[1,"a"]', 'vector')).toBeUndefined();
  });
});

describe('decodeFloat32s', () => {
  const packed = (values: number[]) => new Uint8Array(new Float32Array(values).buffer);

  /** The shortest decimal that reads back to the stored float32, as pgvector prints one. */
  it('should read each float32 as its shortest decimal', () => {
    expect(decodeFloat32s(packed([0.1234567, 3.14159265, 0.5, -2, 0]))).toEqual([0.1234567, 3.1415927, 0.5, -2, 0]);
  });

  it('should read back exactly the float32 each element stored', () => {
    const values = [1e-7, 123456.789, -0.30000001, 16777217, 3.4e38];

    const decoded = decodeFloat32s(packed(values));

    expect(decoded.map(Math.fround)).toEqual(values.map(Math.fround));
  });

  it('should read bytes that start inside a larger buffer', () => {
    const buffer = new Uint8Array(12);
    buffer.set(packed([1.5, -1]), 4);

    expect(decodeFloat32s(buffer.subarray(4))).toEqual([1.5, -1]);
  });
});

describe('encodeFloat32s', () => {
  it('should pack each element as a little-endian float32', () => {
    expect([...encodeFloat32s([1, -2])]).toEqual([0, 0, 128, 63, 0, 0, 0, 192]);
  });

  it('should round-trip through decodeFloat32s', () => {
    expect(decodeFloat32s(encodeFloat32s([0.1234567, 3.1415927, 0.5, -2, 0]))).toEqual([
      0.1234567, 3.1415927, 0.5, -2, 0,
    ]);
  });

  it('should pack an empty vector as no bytes', () => {
    expect(encodeFloat32s([]).byteLength).toBe(0);
  });
});
