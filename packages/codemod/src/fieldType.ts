import ts from 'typescript';

/** The string types carrying more than `string`, e.g. `` type UUID = `${string}-${string}` ``, still string columns. */
const BRANDED_STRING = ts.TypeFlags.TemplateLiteral | ts.TypeFlags.StringMapping;

export function isBrandedString(type: ts.Type): boolean {
  return (type.isUnion() ? type.types : [type]).some((t) => !!(t.getFlags() & BRANDED_STRING));
}

/**
 * Reads a union by requiring its arms to agree, which is what an `'a' | 'b'` enum or a `T | null` looks
 * like. `undefined` and `null` arms are dropped first: they carry no column type of their own.
 */
function foldUnion<T>(type: ts.UnionType, read: (arm: ts.Type) => T | undefined): T | undefined {
  const arms = type.types.filter((arm) => !(arm.getFlags() & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)));
  const readings = new Set(arms.map(read));
  return readings.size === 1 ? [...readings][0] : undefined;
}

/**
 * The `type` option reflection supplied for a property of `type`, mirroring `TypeFor` in `uql-orm`, or nothing
 * for a shape a human decides. Only what reflection could produce is read: a `Json<T>` or vector property got
 * `Object`/`Array` from it, so it already declared its `type`.
 */
export function fieldTypeFor(type: ts.Type): string | undefined {
  const flags = type.getFlags();

  if (type.isUnion()) {
    return foldUnion(type, fieldTypeFor);
  }

  if (flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral | BRANDED_STRING)) return 'String';
  if (flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) return 'Number';
  if (flags & (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral)) return 'BigInt';
  if (flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) return 'Boolean';

  // Matched by declared symbol rather than by the printed type: both of these became generic in the
  // modern lib, so `Uint8Array` prints as `Uint8Array<ArrayBufferLike>` and never compared equal.
  const name = type.getSymbol()?.getName();
  if (name === 'Date') return 'Date';
  if (name === 'Buffer' || name === 'Uint8Array') return "'blob'";

  return undefined;
}

/**
 * The entity name a relation property points at: `Company` for `Company`, `Company[]`, and
 * `Relation<Company>` alike, since `Relation<T>` is an alias for `T` and erases before this runs.
 */
export function relationTargetFor(type: ts.Type, checker: ts.TypeChecker): string | undefined {
  if (type.isUnion()) {
    return foldUnion(type, (arm) => relationTargetFor(arm, checker));
  }

  const elementType = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
  const target = elementType ?? type;
  const symbol = target.getSymbol();
  const name = symbol?.getName();
  return name && name !== '__type' && /^[A-Z][A-Za-z0-9_]*$/.test(name) ? name : undefined;
}
