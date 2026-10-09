import { types } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wireTypes } from './pgWireTypes.js';

/** Postgres' own OIDs, fixed by its catalog: each type uql decodes, and its array. */
const INT8 = 20;
const INT8_ARRAY = 1016;
const TIMESTAMP = 1114;
const TIMESTAMP_ARRAY = 1115;
const DATE_ARRAY = 1182;
const NUMERIC = 1700;
const NUMERIC_ARRAY = 1231;
const FLOAT8_ARRAY = 1022;

/** The wire decode every pg-family pool installs, against `pg`'s real registry. */
describe('wireTypes', () => {
  const parsers = wireTypes(types);
  const parse = (oid: number, text: string, from = parsers) => from.getTypeParser(oid, 'text')(text);

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should decode an INT8 as a number where exact, its text past 2^53', () => {
    expect(parse(INT8, '9')).toBe(9);
    // Past 2^53 a number would round, so the exact text comes back instead.
    expect(parse(INT8, '9007199254740993')).toBe('9007199254740993');
  });

  it('should read a TIMESTAMP, which names no zone, as UTC', () => {
    expect(parse(TIMESTAMP, '2026-09-10 12:30:00.123456')).toEqual(new Date('2026-09-10T12:30:00.123Z'));
  });

  it('should leave NUMERIC to the entity-aware layer, which knows if it was meant as a number', () => {
    // `type: BigInt` also maps to BIGINT, so a blanket decode here is as far as a driver can go.
    expect(parse(NUMERIC, '12345678901234567890.5')).toBe('12345678901234567890.5');
  });

  it('should decode each element of an array as the scalar it holds, nested and null alike', () => {
    expect(parse(INT8_ARRAY, '{1,9007199254740993,NULL}')).toEqual([1, '9007199254740993', null]);
    expect(parse(INT8_ARRAY, '{{1,2},{3,4}}')).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(parse(INT8_ARRAY, '{}')).toEqual([]);
    // `pg` reads a NUMERIC[] as floats, rounding what its scalar keeps exact.
    expect(parse(NUMERIC_ARRAY, '{12345678901234567890.5}')).toEqual(['12345678901234567890.5']);
  });

  it('should read a TIMESTAMP[] or a DATE[] as UTC in any process zone', () => {
    // `pg` reads both arrays in the process's zone, as it would the scalars uql already decodes.
    vi.stubEnv('TZ', 'Pacific/Kiritimati');

    expect(parse(TIMESTAMP_ARRAY, '{"2026-09-10 12:30:00.123"}')).toEqual([new Date('2026-09-10T12:30:00.123Z')]);
    expect(parse(DATE_ARRAY, '{2026-09-10}')).toEqual([new Date('2026-09-10T00:00:00.000Z')]);
  });

  it('should delegate every other type to the driver', () => {
    for (const oid of [types.builtins.TEXT, types.builtins.FLOAT8, types.builtins.TIMESTAMPTZ, FLOAT8_ARRAY]) {
      expect(parsers.getTypeParser(oid, 'text')).toBe(types.getTypeParser(oid, 'text'));
    }
  });

  it('should delegate the binary format, where an INT8 is a Buffer and `Number` would give NaN', () => {
    expect(parsers.getTypeParser(INT8, 'binary')).toBe(types.getTypeParser(INT8, 'binary'));
  });

  it('should take the registry as an argument, so `uql-orm/neon` never has to import `pg`', () => {
    // Neon ships its own copy; anything splitting an array literal works, which is the point.
    const foreign = {
      getTypeParser: (oid: number) => (oid === 1009 ? (text: string) => text.slice(1, -1).split(',') : String),
    };
    expect(parse(INT8, '9', wireTypes(foreign))).toBe(9);
    expect(parse(INT8_ARRAY, '{9,10}', wireTypes(foreign))).toEqual([9, 10]);
    expect(wireTypes(foreign).getTypeParser(25, 'text')).toBe(String);
  });
});
