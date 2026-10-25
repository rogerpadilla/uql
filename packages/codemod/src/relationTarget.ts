import ts from 'typescript';

/** Reads a union by requiring its arms to agree, `undefined` and `null` dropped first: `Company | null` is `Company`. */
function foldUnion<T>(type: ts.UnionType, read: (arm: ts.Type) => T | undefined): T | undefined {
  const arms = type.types.filter((arm) => !(arm.getFlags() & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)));
  const readings = new Set(arms.map(read));
  return readings.size === 1 ? [...readings][0] : undefined;
}

/**
 * The entity name a relation property points at: `Company` for `Company` and `Company[]` alike, since the
 * element of an array is what a to-many relation targets.
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
