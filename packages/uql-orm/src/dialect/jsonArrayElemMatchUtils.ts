/**
 * Shared `$elemMatch` object expansion logic:
 * - for each field:
 *   - if the value is an operator-object (object, non-array), expand each operator
 *   - otherwise treat it as plain equality
 *
 * Dialects decide the actual SQL produced via the callbacks.
 */
export function buildElemMatchConditions(
  match: Record<string, unknown>,
  onOperator: (field: string, op: string, opVal: unknown) => string,
  onEq: (field: string, value: unknown) => string,
): string[] {
  const conditions: string[] = [];

  for (const [field, value] of Object.entries(match)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const ops = value as Record<string, unknown>;
      for (const [op, opVal] of Object.entries(ops)) {
        conditions.push(onOperator(field, op, opVal));
      }
    } else {
      conditions.push(onEq(field, value));
    }
  }

  return conditions;
}
