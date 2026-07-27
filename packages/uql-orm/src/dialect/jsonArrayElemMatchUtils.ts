import { isOperatorObject } from '../util/object.util.js';

/**
 * Expands an `$elemMatch` object into per-field conditions: a field whose value is an operator
 * object contributes one condition per operator, and a plain value contributes an `$eq`.
 *
 * Treating plain equality as `$eq` is what keeps `{ count: 5 }` and `{ count: { $eq: 5 } }`
 * identical - they used to take different code paths and emit different SQL.
 */
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
