import { isOperatorObject } from '../util/object.util.js';

/** An `$elemMatch` as per-field conditions, a plain value as `$eq`, so both spellings emit the same SQL. */
export function buildElemMatchConditions(
  match: Record<string, unknown>,
  onCondition: (field: string, op: string, value: unknown) => string,
): string[] {
  return Object.entries(match).flatMap(([field, value]) =>
    isOperatorObject(value)
      ? Object.entries(value).map(([op, opVal]) => onCondition(field, op, opVal))
      : onCondition(field, '$eq', value),
  );
}
