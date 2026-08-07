import { types } from 'pg';
import { describe, expect, it } from 'vitest';
import { numericTypes } from './pgNumericTypes.js';

/**
 * The wire decode every pg-family pool installs.
 *
 * Exercised against `pg`'s real registry, not only a stub: the OIDs are looked up through
 * `types.builtins`, so a driver that renamed or reshaped that would otherwise leave every wide
 * integer undecoded with nothing failing.
 */
describe('numericTypes', () => {
  const parsers = numericTypes(types);

  it('decodes the two wide numerics Postgres returns as text', () => {
    expect(parsers.getTypeParser(types.builtins.INT8, 'text')).toBe(Number);
    expect(parsers.getTypeParser(types.builtins.FLOAT8, 'text')).toBe(Number);
  });

  it('leaves NUMERIC to the entity-aware layer, which knows if it was meant as a number', () => {
    // `type: BigInt` also maps to BIGINT, so a blanket decode here is as far as a driver can go.
    expect(parsers.getTypeParser(types.builtins.NUMERIC, 'text')).not.toBe(Number);
  });

  it('delegates every other type to the driver', () => {
    for (const oid of [types.builtins.TEXT, types.builtins.BOOL, types.builtins.TIMESTAMPTZ]) {
      expect(parsers.getTypeParser(oid, 'text')).toBe(types.getTypeParser(oid, 'text'));
    }
  });

  it('delegates the binary format, where an INT8 is a Buffer and `Number` would give NaN', () => {
    expect(parsers.getTypeParser(types.builtins.INT8, 'binary')).toBe(
      types.getTypeParser(types.builtins.INT8, 'binary'),
    );
  });

  it('takes the registry as an argument, so `uql-orm/neon` never has to import `pg`', () => {
    // Neon ships its own copy; anything with the same two members works, which is the point.
    const foreign = { builtins: { INT8: 20, FLOAT8: 701 }, getTypeParser: () => String };
    expect(numericTypes(foreign).getTypeParser(20, 'text')).toBe(Number);
    expect(numericTypes(foreign).getTypeParser(25, 'text')).toBe(String);
  });
});
